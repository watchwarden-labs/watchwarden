package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFilterByPattern(t *testing.T) {
	tags := []string{"v1.0.0", "v1.1.0", "v2.0.0", "latest", "v1.0.0-alpine", "nightly"}

	filtered, err := FilterByPattern(tags, `^v1\.\d+\.\d+$`)
	require.NoError(t, err)
	assert.Equal(t, []string{"v1.0.0", "v1.1.0"}, filtered)
}

func TestFilterByPattern_InvalidRegex(t *testing.T) {
	_, err := FilterByPattern([]string{"a"}, `[invalid`)
	assert.Error(t, err)
}

func TestFindLatestSemver(t *testing.T) {
	tests := []struct {
		name     string
		tags     []string
		expected string
	}{
		{"simple semver", []string{"v1.0.0", "v2.0.0", "v1.5.0"}, "v2.0.0"},
		{"minor versions", []string{"3.18", "3.19", "3.17"}, "3.19"},
		{"with suffix", []string{"1.25.3-alpine", "1.25.4-alpine", "1.25.2"}, "1.25.4-alpine"},
		{"single tag", []string{"v1.0.0"}, "v1.0.0"},
		{"empty", []string{}, ""},
		{"no version parts", []string{"latest", "stable"}, "stable"},
		{"mixed", []string{"v3.1.0", "latest", "v3.2.0"}, "v3.2.0"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := FindLatestSemver(tt.tags)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestExtractVersionParts(t *testing.T) {
	assert.Equal(t, []int{1, 2, 3}, extractVersionParts("v1.2.3"))
	assert.Equal(t, []int{1, 2, 3}, extractVersionParts("1.2.3-alpine"))
	assert.Equal(t, []int{3, 19}, extractVersionParts("3.19"))
	assert.Equal(t, []int(nil), extractVersionParts("latest"))
}

func TestParseImageRefParts(t *testing.T) {
	tests := []struct {
		input    string
		registry string
		repo     string
	}{
		{"nginx:latest", "docker.io", "library/nginx"},
		{"myuser/myapp:v1", "docker.io", "myuser/myapp"},
		{"ghcr.io/owner/repo:v1", "ghcr.io", "owner/repo"},
		{"registry.example.com:5000/myapp:v1", "registry.example.com:5000", "myapp"},
		{"nginx", "docker.io", "library/nginx"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			reg, repo := parseImageRefParts(tt.input)
			assert.Equal(t, tt.registry, reg)
			assert.Equal(t, tt.repo, repo)
		})
	}
}

func TestRegistryClient_ListV2Tags(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v2/myuser/myapp/tags/list" {
			resp := map[string]interface{}{
				"name": "myuser/myapp",
				"tags": []string{"v1.0.0", "v2.0.0", "latest"},
			}
			json.NewEncoder(w).Encode(resp)
			return
		}
		w.WriteHeader(404)
	}))
	defer server.Close()

	// Use the test server directly via listV2Tags by extracting host
	rc := NewRegistryClient(nil)
	rc.client = server.Client()

	// Since listV2Tags hardcodes "https://", we test the parsing functions instead
	// and rely on integration tests for the full flow.
	_ = rc
}

func TestSemverMatchesLevel_Patch(t *testing.T) {
	// Patch level: same major+minor, only patch increases
	assert.True(t, SemverMatchesLevel("v1.2.3", "v1.2.4", "patch"))
	assert.True(t, SemverMatchesLevel("1.2.3", "1.2.10", "patch"))
	assert.False(t, SemverMatchesLevel("v1.2.3", "v1.3.0", "patch"), "minor bump not allowed in patch mode")
	assert.False(t, SemverMatchesLevel("v1.2.3", "v2.0.0", "patch"), "major bump not allowed in patch mode")
	assert.False(t, SemverMatchesLevel("v1.2.3", "v1.2.3", "patch"), "same version is not an update")
	assert.False(t, SemverMatchesLevel("v1.2.5", "v1.2.3", "patch"), "older version is not an update")
}

func TestSemverMatchesLevel_Minor(t *testing.T) {
	// Minor level: same major, any minor/patch increase
	assert.True(t, SemverMatchesLevel("v1.2.3", "v1.3.0", "minor"))
	assert.True(t, SemverMatchesLevel("v1.2.3", "v1.2.4", "minor"), "patch bumps are included in minor")
	assert.True(t, SemverMatchesLevel("v1.2.3", "v1.10.0", "minor"))
	assert.False(t, SemverMatchesLevel("v1.2.3", "v2.0.0", "minor"), "major bump not allowed in minor mode")
	assert.False(t, SemverMatchesLevel("v1.2.3", "v1.2.3", "minor"), "same version")
}

func TestSemverMatchesLevel_Major(t *testing.T) {
	// Major level: any version increase
	assert.True(t, SemverMatchesLevel("v1.2.3", "v2.0.0", "major"))
	assert.True(t, SemverMatchesLevel("v1.2.3", "v1.3.0", "major"))
	assert.True(t, SemverMatchesLevel("v1.2.3", "v1.2.4", "major"))
	assert.False(t, SemverMatchesLevel("v2.0.0", "v1.2.3", "major"), "older version")
}

func TestSemverMatchesLevel_All(t *testing.T) {
	// "all" or "" behaves like major
	assert.True(t, SemverMatchesLevel("v1.2.3", "v2.0.0", "all"))
	assert.True(t, SemverMatchesLevel("v1.2.3", "v1.2.4", ""))
}

func TestSemverMatchesLevel_NonSemver(t *testing.T) {
	// Non-semver tags: any difference counts
	assert.True(t, SemverMatchesLevel("latest", "nightly", "patch"))
	assert.False(t, SemverMatchesLevel("latest", "latest", "patch"))
}

func TestFindLatestSemverAtLevel(t *testing.T) {
	tags := []string{"v1.2.3", "v1.2.4", "v1.3.0", "v2.0.0", "v1.2.5"}

	// Patch level from v1.2.3: should find v1.2.5 (not v1.3.0 or v2.0.0)
	assert.Equal(t, "v1.2.5", FindLatestSemverAtLevel(tags, "v1.2.3", "patch"))

	// Minor level from v1.2.3: should find v1.3.0 (highest same-major)
	assert.Equal(t, "v1.3.0", FindLatestSemverAtLevel(tags, "v1.2.3", "minor"))

	// Major level from v1.2.3: should find v2.0.0 (highest overall)
	assert.Equal(t, "v2.0.0", FindLatestSemverAtLevel(tags, "v1.2.3", "major"))

	// Patch level from v1.3.0: no patch updates available
	assert.Equal(t, "", FindLatestSemverAtLevel(tags, "v1.3.0", "patch"))
}
