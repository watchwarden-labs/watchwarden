package main

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScheduler_Enable(t *testing.T) {
	var callCount atomic.Int32
	s := NewLocalScheduler(func() {
		callCount.Add(1)
	})

	err := s.Enable("@every 1s")
	require.NoError(t, err)
	assert.True(t, s.IsActive())

	time.Sleep(2500 * time.Millisecond)
	s.Disable()

	assert.GreaterOrEqual(t, callCount.Load(), int32(2))
}

func TestScheduler_Disable(t *testing.T) {
	var callCount atomic.Int32
	s := NewLocalScheduler(func() {
		callCount.Add(1)
	})

	err := s.Enable("@every 1s")
	require.NoError(t, err)

	time.Sleep(1500 * time.Millisecond)
	s.Disable()
	assert.False(t, s.IsActive())

	countAfterDisable := callCount.Load()
	time.Sleep(2 * time.Second)

	// No more calls after disable
	assert.Equal(t, countAfterDisable, callCount.Load())
}

func TestScheduler_DoubleEnable(t *testing.T) {
	s := NewLocalScheduler(func() {})
	require.NoError(t, s.Enable("@every 5s"))
	require.NoError(t, s.Enable("@every 10s"))
	assert.True(t, s.IsActive())
	s.Disable()
}

func TestScheduler_DoubleDisable(t *testing.T) {
	s := NewLocalScheduler(func() {})
	require.NoError(t, s.Enable("@every 5s"))
	s.Disable()
	assert.NotPanics(t, func() { s.Disable() })
	assert.False(t, s.IsActive())
}

func TestScheduler_EnableAfterDisable(t *testing.T) {
	var callCount atomic.Int32
	s := NewLocalScheduler(func() {
		callCount.Add(1)
	})

	require.NoError(t, s.Enable("@every 1s"))
	time.Sleep(1500 * time.Millisecond)
	s.Disable()

	countAfterFirstDisable := callCount.Load()
	require.Greater(t, countAfterFirstDisable, int32(0))

	require.NoError(t, s.Enable("@every 1s"))
	time.Sleep(1500 * time.Millisecond)
	s.Disable()

	assert.Greater(t, callCount.Load(), countAfterFirstDisable)
}
