package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"regexp"
)

var validScanImageRef = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]+$`)

// Scanner runs Trivy vulnerability scans against Docker images.
type Scanner struct{}

// NewScanner creates a Scanner. Returns nil if trivy is not available.
func NewScanner() *Scanner {
	if _, err := exec.LookPath("trivy"); err != nil {
		log.Println("[scanner] trivy not found — vulnerability scanning disabled")
		return nil
	}
	return &Scanner{}
}

// Scan runs trivy against the image and returns a ScanResult.
func (s *Scanner) Scan(ctx context.Context, containerID, containerName, image string) (*ScanResult, error) {
	if s == nil {
		return nil, fmt.Errorf("scanner not available")
	}

	if !validScanImageRef.MatchString(image) {
		return nil, fmt.Errorf("invalid image reference: %q", image)
	}

	cmd := exec.CommandContext(ctx, "trivy", "image", "--format", "json", "--quiet", image)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("trivy scan failed: %w", err)
	}

	// Parse Trivy JSON output
	var trivyReport struct {
		Results []struct {
			Vulnerabilities []struct {
				VulnerabilityID string `json:"VulnerabilityID"`
				Severity        string `json:"Severity"`
				PkgName         string `json:"PkgName"`
				FixedVersion    string `json:"FixedVersion"`
			} `json:"Vulnerabilities"`
		} `json:"Results"`
	}
	if err := json.Unmarshal(out, &trivyReport); err != nil {
		return nil, fmt.Errorf("failed to parse trivy output: %w", err)
	}

	result := &ScanResult{
		ContainerID:   containerID,
		ContainerName: containerName,
		Image:         image,
	}
	for _, r := range trivyReport.Results {
		for _, v := range r.Vulnerabilities {
			switch v.Severity {
			case "CRITICAL":
				result.Critical++
			case "HIGH":
				result.High++
			case "MEDIUM":
				result.Medium++
			case "LOW":
				result.Low++
			}
			if result.Critical+result.High+result.Medium+result.Low <= 50 {
				result.Details = append(result.Details, VulnDetail{
					ID:       v.VulnerabilityID,
					Severity: v.Severity,
					Package:  v.PkgName,
					Fixed:    v.FixedVersion,
				})
			}
		}
	}
	return result, nil
}
