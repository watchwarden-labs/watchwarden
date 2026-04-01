package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

func TestCredStore_AuthType(t *testing.T) {
	cs := NewCredStore()
	cs.Set([]RegistryCredential{
		{Registry: "123456.dkr.ecr.us-east-1.amazonaws.com", Username: "AWS", Password: "old-token", AuthType: "ecr"},
		{Registry: "ghcr.io", Username: "user", Password: "pass", AuthType: "basic"},
	})

	ecr := cs.GetForImage("123456.dkr.ecr.us-east-1.amazonaws.com/myapp:latest")
	require.NotNil(t, ecr)
	assert.Equal(t, "ecr", ecr.AuthType)

	basic := cs.GetForImage("ghcr.io/myorg/myapp:latest")
	require.NotNil(t, basic)
	assert.Equal(t, "basic", basic.AuthType)
}

func TestCredStore_GCRJsonKey(t *testing.T) {
	cs := NewCredStore()
	cs.Set([]RegistryCredential{
		{Registry: "gcr.io", Username: "_json_key", Password: `{"type":"service_account"}`, AuthType: "gcr"},
	})

	cred := cs.GetForImage("gcr.io/myproject/myimage:latest")
	require.NotNil(t, cred)
	assert.Equal(t, "_json_key", cred.Username)
	assert.Equal(t, "gcr", cred.AuthType)
}
