import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import TerminalShowcase from '../components/TerminalShowcase';
import styles from './index.module.css';

const features = [
  {
    icon: '🔄',
    title: 'Blue-Green Deployments',
    description:
      'Start the new container first, verify health checks pass, then stop the old one. Zero downtime, zero risk.',
  },
  {
    icon: '📸',
    title: 'Snapshot Rollbacks',
    description:
      'Every update saves a full container snapshot. One-click revert to the exact previous state — config, networks, volumes.',
  },
  {
    icon: '🎛️',
    title: 'Managed or Solo',
    description:
      'Centralized dashboard with multi-host control, or lightweight standalone mode as a Watchtower drop-in replacement.',
  },
];

const moreFeatures = [
  {
    icon: '🛡️',
    title: 'Crash-Loop Protection',
    description:
      'Detects containers stuck in restart loops and auto-rolls back to the last stable version.',
  },
  {
    icon: '🔔',
    title: 'Built-in Notifications',
    description:
      'Telegram, Slack, and webhook notifications out of the box. Batched and rate-limited to prevent spam.',
  },
  {
    icon: '🐳',
    title: 'Watchtower Compatible',
    description:
      'Drop-in replacement — all standard WATCHTOWER_* environment variables work automatically.',
  },
];

function Hero() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div className="container">
        <div className={styles.badge}>Open Source Docker Automation</div>
        <h1 className={styles.heroTitle}>{siteConfig.tagline}</h1>
        <p className={styles.heroSubtitle}>
          Keep every container up to date across all your Docker hosts.
          Blue-green deployments, automatic rollbacks, real-time dashboard —
          or run standalone as a smarter Watchtower.
        </p>
        <div className={styles.buttons}>
          <Link className="button button--primary button--lg" to="/docs/getting-started">
            Get Started
          </Link>
          <Link
            className="button button--outline button--lg"
            href="https://github.com/watchwarden-labs/watchwarden"
          >
            GitHub
          </Link>
        </div>
        <div className={styles.codePreview}>
          <TerminalShowcase />
        </div>
      </div>
    </header>
  );
}

function FeatureCard({ icon, title, description }) {
  return (
    <div className={styles.featureCard}>
      <div className={styles.featureIcon}>{icon}</div>
      <div className={styles.featureTitle}>{title}</div>
      <div className={styles.featureDesc}>{description}</div>
    </div>
  );
}

function Features() {
  return (
    <section className={styles.features}>
      <div className="container">
        <h2 className={styles.sectionTitle}>Why WatchWarden?</h2>
        <div className={styles.featureGrid}>
          {features.map((f, i) => (
            <FeatureCard key={i} {...f} />
          ))}
        </div>
      </div>
    </section>
  );
}

function MoreFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <h2 className={styles.sectionTitle}>And More</h2>
        <div className={styles.featureGrid}>
          {moreFeatures.map((f, i) => (
            <FeatureCard key={i} {...f} />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title="Home" description={siteConfig.tagline}>
      <Hero />
      <main>
        <Features />
        <MoreFeatures />
      </main>
    </Layout>
  );
}
