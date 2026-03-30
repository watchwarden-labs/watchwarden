package main

import (
	"sync"

	"github.com/robfig/cron/v3"
)

// LocalScheduler manages a cron fallback schedule for when the controller is unavailable.
type LocalScheduler struct {
	c       *cron.Cron
	entryID cron.EntryID
	active  bool
	checkFn func()
	mu      sync.Mutex
}

// NewLocalScheduler creates a new scheduler with the given check function.
func NewLocalScheduler(checkFn func()) *LocalScheduler {
	return &LocalScheduler{
		checkFn: checkFn,
	}
}

// Enable starts the cron schedule.
func (s *LocalScheduler) Enable(schedule string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Stop existing cron if any
	if s.c != nil {
		s.c.Stop()
	}

	s.c = cron.New()
	id, err := s.c.AddFunc(schedule, s.checkFn)
	if err != nil {
		return err
	}
	s.entryID = id
	s.c.Start()
	s.active = true
	return nil
}

// Disable stops the cron schedule.
func (s *LocalScheduler) Disable() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.c != nil {
		s.c.Stop()
		s.c = nil
	}
	s.active = false
}

// IsActive returns whether the scheduler is running.
func (s *LocalScheduler) IsActive() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.active
}
