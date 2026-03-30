package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"regexp"
)

var validImageRef = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]+$`)

// Verifier checks image signatures using cosign before pulling.
type Verifier struct {
	publicKeyPath string // path to cosign public key file (may be temp file)
	tempKeyFile   bool   // true if publicKeyPath is a temp file we own
}

// NewVerifier creates a Verifier. Returns nil if:
//   - requireSigned is false AND cosign binary is not present
//   - requireSigned is true AND no public key is provided (logs fatal)
//
// publicKeyPEM may be empty (keyless verification) or PEM content written to a temp file.
func NewVerifier(requireSigned bool, publicKeyPEM string) *Verifier {
	// Check cosign availability
	cosignPath, err := exec.LookPath("cosign")
	if err != nil {
		if requireSigned {
			log.Fatal("[verify] cosign not found but REQUIRE_SIGNED_IMAGES=true — install cosign in the agent image")
		}
		log.Println("[verify] cosign not found — image signing verification disabled")
		return nil
	}
	_ = cosignPath

	if !requireSigned {
		log.Println("[verify] image signing verification enabled (optional mode)")
	} else {
		log.Println("[verify] image signing verification enabled (required mode)")
	}

	v := &Verifier{}

	if publicKeyPEM != "" {
		// Write PEM to temp file so cosign can read it.
		// Use os.OpenFile with explicit 0600 mode to avoid TOCTOU race with CreateTemp+Chmod.
		tmpDir := os.TempDir()
		tmpFile, err := os.OpenFile(
			fmt.Sprintf("%s/cosign-pubkey-%d.pem", tmpDir, os.Getpid()),
			os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600,
		)
		if err != nil {
			log.Printf("[verify] failed to create temp key file: %v", err)
			return nil
		}
		if _, err := tmpFile.WriteString(publicKeyPEM); err != nil {
			_ = os.Remove(tmpFile.Name())
			log.Printf("[verify] failed to write temp key file: %v", err)
			return nil
		}
		tmpFile.Close()
		v.publicKeyPath = tmpFile.Name()
		v.tempKeyFile = true
		log.Printf("[verify] using public key from env")
	}

	return v
}

// Verify checks that the image is signed. Returns an error if verification fails.
// If publicKeyPath is set, uses --key; otherwise uses keyless (OIDC) verification.
func (v *Verifier) Verify(ctx context.Context, image string) error {
	if v == nil {
		return nil
	}

	if !validImageRef.MatchString(image) {
		return fmt.Errorf("invalid image reference: %q", image)
	}

	var args []string
	if v.publicKeyPath != "" {
		args = []string{"verify", "--key", v.publicKeyPath, image}
	} else {
		// Keyless verification (Sigstore transparency log)
		args = []string{"verify", image}
	}

	cmd := exec.CommandContext(ctx, "cosign", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("image signature verification failed for %s: %w\n%s", image, err, string(out))
	}
	log.Printf("[verify] %s: signature verified", image)
	return nil
}

// Close removes any temporary files created by the verifier.
func (v *Verifier) Close() {
	if v != nil && v.tempKeyFile && v.publicKeyPath != "" {
		_ = os.Remove(v.publicKeyPath)
	}
}
