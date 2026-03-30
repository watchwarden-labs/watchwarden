package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParseRegistry(t *testing.T) {
	tests := []struct {
		image    string
		expected string
	}{
		{"nginx", "index.docker.io"},
		{"nginx:latest", "index.docker.io"},
		{"library/nginx", "index.docker.io"},
		{"myuser/myapp:v1", "index.docker.io"},
		{"ghcr.io/user/app:tag", "ghcr.io"},
		{"ghcr.io/user/app", "ghcr.io"},
		{"registry.example.com/app", "registry.example.com"},
		{"registry.example.com/org/app:v2", "registry.example.com"},
		{"registry.example.com:5000/app", "registry.example.com:5000"},
		{"nginx@sha256:abc123", "index.docker.io"},
		{"ghcr.io/user/app@sha256:abc", "ghcr.io"},
	}

	for _, tc := range tests {
		t.Run(tc.image, func(t *testing.T) {
			assert.Equal(t, tc.expected, parseRegistry(tc.image))
		})
	}
}

func TestCredStore_GetForImage(t *testing.T) {
	store := NewCredStore()
	store.Set([]RegistryCredential{
		{Registry: "ghcr.io", Username: "user", Password: "token"},
		{Registry: "index.docker.io", Username: "docker_user", Password: "docker_pass"},
	})

	t.Run("matches ghcr.io image", func(t *testing.T) {
		cred := store.GetForImage("ghcr.io/myorg/myapp:latest")
		assert.NotNil(t, cred)
		assert.Equal(t, "ghcr.io", cred.Registry)
		assert.Equal(t, "user", cred.Username)
	})

	t.Run("matches Docker Hub image", func(t *testing.T) {
		cred := store.GetForImage("nginx:latest")
		assert.NotNil(t, cred)
		assert.Equal(t, "index.docker.io", cred.Registry)
	})

	t.Run("returns nil for unknown registry", func(t *testing.T) {
		cred := store.GetForImage("quay.io/some/image")
		assert.Nil(t, cred)
	})
}

func TestCredStore_Set(t *testing.T) {
	store := NewCredStore()
	assert.Nil(t, store.GetForImage("nginx"))

	store.Set([]RegistryCredential{
		{Registry: "index.docker.io", Username: "u", Password: "p"},
	})
	assert.NotNil(t, store.GetForImage("nginx"))

	// Replace with empty
	store.Set(nil)
	assert.Nil(t, store.GetForImage("nginx"))
}
