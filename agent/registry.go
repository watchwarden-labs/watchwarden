package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// RegistryClient queries Docker registries for tag information.
type RegistryClient struct {
	client    *http.Client
	credStore *CredStore
}

// NewRegistryClient creates a registry client.
func NewRegistryClient(credStore *CredStore) *RegistryClient {
	return &RegistryClient{
		client:    &http.Client{Timeout: 30 * time.Second},
		credStore: credStore,
	}
}

// TagInfo holds tag name and optional digest.
type TagInfo struct {
	Name   string
	Digest string
}

// ListTags queries the registry for all tags of the given image.
func (r *RegistryClient) ListTags(ctx context.Context, imageRef string) ([]string, error) {
	registry, repository := parseImageRefParts(imageRef)

	if registry == "docker.io" || registry == "index.docker.io" || registry == "" {
		return r.listDockerHubTags(ctx, repository)
	}
	return r.listV2Tags(ctx, registry, repository)
}

// FilterByPattern filters tags matching a regex pattern.
func FilterByPattern(tags []string, pattern string) ([]string, error) {
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("invalid tag pattern %q: %w", pattern, err)
	}
	var matched []string
	for _, t := range tags {
		if re.MatchString(t) {
			matched = append(matched, t)
		}
	}
	return matched, nil
}

// semverTag pairs a tag with its extracted numeric version parts for sorting.
type semverTag struct {
	original string
	parts    []int
}

// FindLatestSemver sorts tags by semver-like ordering and returns the "newest".
// Tags without numeric parts are sorted lexicographically after semver tags.
func FindLatestSemver(tags []string) string {
	if len(tags) == 0 {
		return ""
	}

	parsed := make([]semverTag, len(tags))
	for i, t := range tags {
		parsed[i] = semverTag{original: t, parts: extractVersionParts(t)}
	}

	sort.Slice(parsed, func(i, j int) bool {
		a, b := parsed[i].parts, parsed[j].parts
		maxLen := len(a)
		if len(b) > maxLen {
			maxLen = len(b)
		}
		for k := 0; k < maxLen; k++ {
			av, bv := 0, 0
			if k < len(a) {
				av = a[k]
			}
			if k < len(b) {
				bv = b[k]
			}
			if av != bv {
				return av > bv // descending
			}
		}
		return parsed[i].original > parsed[j].original // fallback lexicographic
	})

	return parsed[0].original
}

// SemverMatchesLevel checks if `candidate` is a valid update for `current` at the given level.
// Levels: "major" (any), "minor" (same major), "patch" (same major+minor), "all" (any change).
// Returns true if the candidate is newer and matches the level constraint.
func SemverMatchesLevel(current, candidate, level string) bool {
	currentParts := extractVersionParts(current)
	candidateParts := extractVersionParts(candidate)

	if len(currentParts) == 0 || len(candidateParts) == 0 {
		// Can't parse semver — allow any change
		return candidate != current
	}

	// Pad to at least 3 parts
	for len(currentParts) < 3 {
		currentParts = append(currentParts, 0)
	}
	for len(candidateParts) < 3 {
		candidateParts = append(candidateParts, 0)
	}

	switch level {
	case "patch":
		// Same major AND minor, any patch change
		return candidateParts[0] == currentParts[0] &&
			candidateParts[1] == currentParts[1] &&
			candidateParts[2] > currentParts[2]
	case "minor":
		// Same major, any minor/patch change
		if candidateParts[0] != currentParts[0] {
			return false
		}
		if candidateParts[1] > currentParts[1] {
			return true
		}
		return candidateParts[1] == currentParts[1] && candidateParts[2] > currentParts[2]
	case "major", "all", "":
		// Any version increase
		for i := 0; i < 3; i++ {
			if candidateParts[i] > currentParts[i] {
				return true
			}
			if candidateParts[i] < currentParts[i] {
				return false
			}
		}
		return false
	default:
		return candidate != current
	}
}

// FindLatestSemverAtLevel finds the latest tag that satisfies the update level constraint
// relative to the current tag. Returns empty string if no qualifying update exists.
func FindLatestSemverAtLevel(tags []string, currentTag, level string) string {
	if len(tags) == 0 || level == "" {
		return FindLatestSemver(tags)
	}

	var eligible []string
	for _, t := range tags {
		if SemverMatchesLevel(currentTag, t, level) {
			eligible = append(eligible, t)
		}
	}

	return FindLatestSemver(eligible)
}

// extractVersionParts extracts numeric components from a version string.
// "v1.2.3-alpine" -> [1, 2, 3]
// "3.19" -> [3, 19]
// "latest" -> []
func extractVersionParts(tag string) []int {
	// Strip common prefixes
	tag = strings.TrimPrefix(tag, "v")
	tag = strings.TrimPrefix(tag, "V")

	var parts []int
	for _, segment := range strings.FieldsFunc(tag, func(r rune) bool {
		return r == '.' || r == '-' || r == '_'
	}) {
		n, err := strconv.Atoi(segment)
		if err == nil {
			parts = append(parts, n)
		}
	}
	return parts
}

// parseImageRefParts splits "registry/repo:tag" into (registry, repository).
func parseImageRefParts(ref string) (string, string) {
	// Strip tag/digest
	if idx := strings.LastIndex(ref, ":"); idx > 0 && !strings.Contains(ref[idx:], "/") {
		ref = ref[:idx]
	}
	if idx := strings.Index(ref, "@"); idx > 0 {
		ref = ref[:idx]
	}

	// Check for registry prefix (contains . or :)
	firstSlash := strings.Index(ref, "/")
	if firstSlash > 0 {
		prefix := ref[:firstSlash]
		if strings.Contains(prefix, ".") || strings.Contains(prefix, ":") {
			return prefix, ref[firstSlash+1:]
		}
	}

	// Docker Hub
	if !strings.Contains(ref, "/") {
		return "docker.io", "library/" + ref
	}
	return "docker.io", ref
}

func (r *RegistryClient) listDockerHubTags(ctx context.Context, repository string) ([]string, error) {
	url := fmt.Sprintf("https://hub.docker.com/v2/repositories/%s/tags?page_size=100", repository)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Docker Hub API error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Docker Hub returned %d for %s", resp.StatusCode, repository)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}

	var result struct {
		Results []struct {
			Name string `json:"name"`
		} `json:"results"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse Docker Hub response: %w", err)
	}

	tags := make([]string, len(result.Results))
	for i, r := range result.Results {
		tags[i] = r.Name
	}
	return tags, nil
}

func (r *RegistryClient) listV2Tags(ctx context.Context, registry, repository string) ([]string, error) {
	url := fmt.Sprintf("https://%s/v2/%s/tags/list", registry, repository)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	// Add auth if available
	if r.credStore != nil {
		imageRef := registry + "/" + repository
		if cred := r.credStore.GetForImage(imageRef); cred != nil {
			// Try basic auth
			req.SetBasicAuth(cred.Username, cred.Password)
		}
	}

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("registry API error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 {
		// Try bearer token auth
		authHeader := resp.Header.Get("Www-Authenticate")
		token, tokenErr := r.fetchBearerToken(ctx, registry, repository, authHeader)
		if tokenErr != nil {
			return nil, fmt.Errorf("registry auth failed: %w", tokenErr)
		}
		req2, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
		req2.Header.Set("Authorization", "Bearer "+token)
		resp2, err2 := r.client.Do(req2)
		if err2 != nil {
			return nil, err2
		}
		defer resp2.Body.Close()
		resp = resp2
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("registry returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}

	var result struct {
		Tags []string `json:"tags"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse registry response: %w", err)
	}
	return result.Tags, nil
}

func (r *RegistryClient) fetchBearerToken(ctx context.Context, registry, repository, wwwAuth string) (string, error) {
	// Parse WWW-Authenticate: Bearer realm="...",service="...",scope="..."
	realm := extractParam(wwwAuth, "realm")
	service := extractParam(wwwAuth, "service")
	if realm == "" {
		realm = fmt.Sprintf("https://%s/token", registry)
	}
	if service == "" {
		service = registry
	}

	tokenURL := fmt.Sprintf("%s?service=%s&scope=repository:%s:pull", realm, service, repository)
	req, err := http.NewRequestWithContext(ctx, "GET", tokenURL, nil)
	if err != nil {
		return "", err
	}

	if r.credStore != nil {
		imageRef := registry + "/" + repository
		if cred := r.credStore.GetForImage(imageRef); cred != nil {
			req.SetBasicAuth(cred.Username, cred.Password)
		}
	}

	resp, err := r.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var tokenResp struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", err
	}
	if tokenResp.Token != "" {
		return tokenResp.Token, nil
	}
	return tokenResp.AccessToken, nil
}

func extractParam(header, key string) string {
	prefix := key + `="`
	idx := strings.Index(header, prefix)
	if idx < 0 {
		return ""
	}
	start := idx + len(prefix)
	end := strings.Index(header[start:], `"`)
	if end < 0 {
		return ""
	}
	return header[start : start+end]
}
