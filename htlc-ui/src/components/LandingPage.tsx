import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import LANDING_CSS from './landing/LandingCSS';

const MARQUEE_LOGOS: Array<{type:'img'|'text', src?:string, alt?:string, label?:string, round?:boolean}> = [
  {type:'img', src:'/marquee-midnight-full.png', alt:'Midnight'},
  {type:'img', src:'/marquee-cardano-icon.png', alt:'Cardano'},
  {type:'text', label:'CARDANO'},
  {type:'img', src:'/marquee-kaamos-icon.png', alt:'Kaamos', round:true},
  {type:'text', label:'KAAMOS'},
  {type:'img', src:'/marquee-usdm.jpg', alt:'USDM', round:true},
  {type:'text', label:'USDM'},
  {type:'img', src:'/marquee-midnight-icon.png', alt:'Midnight'},
  {type:'text', label:'ATOMIC SWAPS'},
  {type:'img', src:'/marquee-cardano-full.png', alt:'Cardano Foundation'},
  {type:'text', label:'CROSS-CHAIN'},
  {type:'img', src:'/marquee-kaamos.png', alt:'Kaamos'},
  {type:'text', label:'SELF-CUSTODY'},
  {type:'img', src:'/marquee-midnight-full.png', alt:'Midnight'},
  {type:'text', label:'ZK COMPLIANCE'},
];
const PHRASES = ['Zero Counterparty Risk.','Self-Custody Execution.','Atomic Settlement.','Full Compliance'];

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const rotRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // Inject CSS
    const style = document.createElement('style');
    style.textContent = LANDING_CSS;
    document.head.appendChild(style);

    // Rotating text
    let idx = 0;
    const iv = setInterval(() => {
      const el = rotRef.current; if (!el) return;
      el.style.transform = 'rotateX(-90deg)'; el.style.opacity = '0';
      setTimeout(() => {
        idx = (idx + 1) % PHRASES.length;
        el.textContent = PHRASES[idx];
        el.style.transform = 'rotateX(90deg)';
        void el.offsetWidth;
        requestAnimationFrame(() => { el.style.transform = 'rotateX(0deg)'; el.style.opacity = '1'; });
      }, 400);
    }, 2800);

    // Sticky nav
    const onScroll = () => {
      const sn = document.getElementById('klpStickyNav');
      if (sn) sn.classList.toggle('visible', window.scrollY > window.innerHeight * 0.3);
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // Scroll-triggered animations
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { const d = (e.target as HTMLElement).dataset.delay || '0'; setTimeout(() => e.target.classList.add('in-view'), +d); obs.unobserve(e.target); } });
    }, { threshold: 0.15 });
    rootRef.current?.querySelectorAll('[data-animate]').forEach(el => obs.observe(el));

    // Counter animation
    const cobs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { const t = +(e.target as HTMLElement).dataset.target!; const s = performance.now(); const a = (n: number) => { const p = Math.min((n-s)/1800,1); (e.target as HTMLElement).textContent = String(Math.round((1-Math.pow(1-p,3))*t)); if(p<1) requestAnimationFrame(a); }; requestAnimationFrame(a); cobs.unobserve(e.target); } });
    }, { threshold: 0.3 });
    rootRef.current?.querySelectorAll('.counter').forEach(el => cobs.observe(el));

    // FAQ accordion
    rootRef.current?.querySelectorAll('.faq-question').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        const isOpen = item?.classList.contains('expanded');
        rootRef.current?.querySelectorAll('.faq-item').forEach(i => i.classList.remove('expanded'));
        if (!isOpen) item?.classList.add('expanded');
      });
    });

    return () => { clearInterval(iv); window.removeEventListener('scroll', onScroll); document.head.removeChild(style); obs.disconnect(); cobs.disconnect(); };
  }, []);

  const goApp = (e: React.MouseEvent) => { e.preventDefault(); navigate('/app'); };
  const marqueeItems = [...MARQUEE_LOGOS,...MARQUEE_LOGOS,...MARQUEE_LOGOS];
  const marquee = marqueeItems.map((item,i) => 
    item.type === 'img' 
      ? <img key={i} src={item.src} alt={item.alt} className={item.round ? 'round' : ''} />
      : <span key={i}>{item.label}</span>
  );

  return (
    <div className="klp" ref={rootRef}>
      {/* Top Banner */}
      <div className="top-banner"><div className="top-banner-inner">
        <span className="top-banner-text">Live on Preprod — Midnight × Cardano</span>
        <a className="top-banner-link" href="#" onClick={goApp}>Start Trading ›</a>
      </div></div>

      {/* Header */}
      <header className="header" id="header"><div className="nav-container">
        <a href="#" className="logo"><img src="/kaamos-full.png" alt="Kaamos" className="logo-img" /><img src="/kaamos-wordmark.png" alt="KAAMOS" className="logo-wordmark" /></a>
        <nav className="nav-links" aria-label="Main navigation">
          <a href="#overview">Overview</a><a href="#product">Product</a><a href="#features">Features</a><a href="#faq">FAQ</a>
        </nav>
        <a href="#" className="nav-cta" onClick={goApp}>Launch App</a>
      </div></header>

      {/* Sticky Nav */}
      <div className="sticky-nav" id="klpStickyNav"><nav className="sticky-nav-inner">
        <a href="#" className="logo logo--small"><img src="/kaamos-full.png" alt="Kaamos" className="logo-img logo-img--small" /><img src="/kaamos-wordmark.png" alt="KAAMOS" className="logo-wordmark logo-wordmark--small" /></a>
        <div className="sticky-nav-links"><a href="#overview">Overview</a><a href="#product">Product</a><a href="#features">Features</a><a href="#faq">FAQ</a></div>
        <a href="#" className="nav-cta nav-cta--small" onClick={goApp}>Launch App</a>
      </nav></div>

      {/* Hero */}
      <section className="hero" id="hero">
        <div className="hero-bg">
          <video className="hero-video" autoPlay muted loop playsInline preload="auto"><source src="/hero.mp4" type="video/mp4" /></video>
          <div className="hero-video-overlay" /><div className="hero-video-gradient" />
        </div>
        <div className="hero-content"><div className="hero-text-block">
          <h1 className="hero-title" data-animate="fade-up">
            <span className="hero-rotating-wrapper"><span className="hero-rotating-text" ref={rotRef}>Zero Counterparty Risk.</span></span>
            <span className="hero-static-text">
              The OTC Rail for <span className="accent-text">Digital Assets.</span>
            </span>
          </h1>
          <p className="hero-subtitle" data-animate="fade-up" data-delay="400">
            Regulatory-compliant, direct institutional settlement across chains. Execute private, atomic token swaps between verified counterparties with no custodian, no exchange, and zero counterparty risk.
          </p>
          <div className="hero-actions" data-animate="fade-up" data-delay="700">
            <a href="#" className="btn btn-primary" onClick={goApp}>Launch App</a>
            <a href="https://github.com/kaleababayneh/midswap-otc" className="btn btn-ghost" target="_blank" rel="noreferrer">Read the Docs</a>
          </div>
        </div></div>
        <div className="hero-partners"><div className="marquee"><div className="marquee-track">{marquee}</div></div></div>
      </section>

      {/* Stats / Overview */}
      <section className="stats-section" id="overview"><div className="container">
        <div className="stats-grid">
          <div className="stat-block" data-animate="fade-up">
            <div className="stat-bg-text">$846T</div>
            <p className="stat-label">The Market</p>
            <div className="stat-value">$<span className="counter" data-target="846">0</span>T</div>
            <p className="stat-desc">in global OTC derivatives — largely institutional, largely unserved by on-chain infrastructure.</p>
          </div>
          <div className="stat-block" data-animate="fade-up" data-delay="200">
            <div className="stat-bg-text">$500M</div>
            <p className="stat-label">Cardano + Midnight</p>
            <div className="stat-value">$<span className="counter" data-target="500">0</span>M+</div>
            <p className="stat-desc">in total value locked across Cardano DeFi and the emerging Midnight privacy ecosystem.</p>
          </div>
        </div>

        {/* Three pillars */}
        <div className="pillars" data-animate="fade-up" data-delay="400">
          <div className="pillar-card">
            <p className="pillar-fig">01</p>
            <div className="pillar-icon-area"><svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="28" stroke="rgba(45,212,191,0.3)" strokeWidth="1.5"/><circle cx="32" cy="32" r="18" stroke="rgba(45,212,191,0.5)" strokeWidth="1.5"/><circle cx="32" cy="32" r="6" fill="rgba(45,212,191,0.8)"/></svg></div>
            <h3 className="pillar-title">Trustless Escrow</h3>
            <p className="pillar-desc">Hash-time-locked contracts ensure both parties settle or both reclaim. No intermediary required. All-or-nothing execution.</p>
          </div>
          <div className="pillar-card">
            <p className="pillar-fig">02</p>
            <div className="pillar-icon-area"><svg viewBox="0 0 64 64" fill="none"><rect x="8" y="8" width="48" height="48" rx="8" stroke="rgba(45,212,191,0.3)" strokeWidth="1.5"/><path d="M20 44 L32 20 L44 44" stroke="rgba(45,212,191,0.8)" strokeWidth="2" fill="none" strokeLinecap="round"/></svg></div>
            <h3 className="pillar-title">Native Cross-Chain</h3>
            <p className="pillar-desc">Aiken on Cardano, Compact on Midnight. No bridges, no wrapped tokens, pure native execution on each chain.</p>
          </div>
          <div className="pillar-card">
            <p className="pillar-fig">03</p>
            <div className="pillar-icon-area"><svg viewBox="0 0 64 64" fill="none"><path d="M32 4 L60 18 L60 46 L32 60 L4 46 L4 18Z" stroke="rgba(45,212,191,0.3)" strokeWidth="1.5" fill="none"/><circle cx="32" cy="32" r="10" stroke="rgba(45,212,191,0.8)" strokeWidth="1.5"/></svg></div>
            <h3 className="pillar-title">Verified Counterparties</h3>
            <p className="pillar-desc">Permissioned institutional environment with ZK-based on-chain KYB verification. Compliance without surveillance.</p>
          </div>
        </div>

        <div className="section-bridge" data-animate="fade-up">
          <div className="bridge-line" style={{transform:'scaleX(1)'}} />
          <p className="bridge-text" style={{opacity:1}}>Kaamos brings private institutional settlement on-chain.</p>
        </div>
      </div></section>

      {/* Product */}
      <section className="product-section" id="product"><div className="container">
        <div className="product-header">
          <p className="section-tag" data-animate="fade-up">The Platform</p>
          <h2 className="section-title" data-animate="fade-up" data-delay="100">Trade With Confidence</h2>
          <p className="section-desc" data-animate="fade-up" data-delay="200">
            Institutions don't just need access to liquidity. They need permission to access it. They need to prove who they are, where they operate, and that their counterparty isn't sanctioned — before a single dollar moves.
          </p>
        </div>
        <div className="product-cards">
          <div className="product-card" data-animate="fade-up" data-delay="300">
            <h3>Atomic Bilateral Settlement</h3>
            <p>Both parties lock assets into smart contract escrows. The swap executes atomically — both transfers succeed or both fail. No partial fills, no exposure window, no intermediary.</p>
          </div>
          <div className="product-card" data-animate="fade-up" data-delay="400">
            <h3>Counterparty Selection</h3>
            <p>Filter by jurisdiction: FINMA-Licensed, EU MiCA-Authorised, UK FCA-Registered, ADGM FSRA-Regulated, Hong Kong SFC-Licensed, or manually approved institutions.</p>
          </div>
          <div className="product-card" data-animate="fade-up" data-delay="500">
            <h3>Self-Custody Architecture</h3>
            <p>Your keys sign every transaction. Assets remain in your custody until the exact moment of atomic settlement. Nothing custodial, ever. Compliance without surveillance.</p>
          </div>
        </div>

        {/* Vault Card */}
        <div className="vault-card" data-animate="fade-up" data-delay="300"><div className="vault-card-inner">
          <div className="vault-header"><div>
            <h3 className="vault-name">Eligible Counterparty Framework</h3>
            <p className="vault-subtitle">Granular Regulatory Compliance Controls</p>
          </div></div>
          <div className="vault-divider" />
          <div className="vault-params">
            <div className="vault-param"><div className="vault-param-label">FINMA</div><div className="vault-param-value">Swiss Banks ✓</div></div>
            <div className="vault-param"><div className="vault-param-label">EU MiCA</div><div className="vault-param-value">CASP Licensed ✓</div></div>
            <div className="vault-param"><div className="vault-param-label">UK FCA</div><div className="vault-param-value">AML/CTF Reg ✓</div></div>
            <div className="vault-param"><div className="vault-param-label">HK SFC</div><div className="vault-param-value">Type 1 / 7 ✓</div></div>
          </div>
          <div className="vault-divider" />
          <div className="vault-metrics">
            <div className="vault-metric"><div className="vault-metric-value">USDM ↔ USDC</div><div className="vault-metric-label">Trading Pair</div></div>
            <div className="vault-metric"><div className="vault-metric-value">Atomic</div><div className="vault-metric-label">Settlement</div></div>
            <div className="vault-metric"><div className="vault-metric-value">Zero</div><div className="vault-metric-label">Counterparty Risk</div></div>
          </div>
        </div></div>
      </div></section>

      {/* Features / Roadmap */}
      <section className="features-section" id="features"><div className="container">
        <div className="features-header">
          <p className="section-tag" data-animate="fade-up">Privacy Infrastructure</p>
          <h2 className="section-title" data-animate="fade-up" data-delay="100">Built for Today, Evolving for Tomorrow</h2>
          <p className="section-desc" data-animate="fade-up" data-delay="200">
            Kaamos is live today with trustless settlement. Our integration with Midnight's private smart contracts unlocks true confidential OTC workflows — private quote negotiation, hidden counterparties, and ZK-based KYB proofs.
          </p>
        </div>
        <div className="features-stats" data-animate="fade-up" data-delay="300">
          <div className="feature-stat"><div className="feature-stat-value"><span className="counter" data-target="100">0</span>%</div><div className="feature-stat-label">Self-Custody</div></div>
          <div className="feature-stat"><div className="feature-stat-value"><span className="counter" data-target="0">0</span></div><div className="feature-stat-label">Counterparty Risk</div></div>
          <div className="feature-stat"><div className="feature-stat-value"><span className="counter" data-target="2">0</span></div><div className="feature-stat-label">Chains Supported</div></div>
          <div className="feature-stat"><div className="feature-stat-value">&lt;<span className="counter" data-target="30">0</span>s</div><div className="feature-stat-label">Settlement Time</div></div>
        </div>

        <div className="cta-block" data-animate="fade-up">
          <div className="cta-bg">
            <video className="cta-video" autoPlay muted loop playsInline preload="auto"><source src="/hero.mp4" type="video/mp4" /></video>
            <div className="cta-video-overlay" />
          </div>
          <div className="cta-content">
            <h2>Start Trading on Kaamos</h2>
            <p>Execute private, atomic OTC swaps between Cardano and Midnight. No custodian. No bridge. No trust required.</p>
            <a href="#" className="btn btn-white btn-glow" onClick={goApp}>Launch App</a>
          </div>
        </div>
      </div></section>

      {/* FAQ */}
      <section className="faq-section" id="faq"><div className="container"><div className="faq-layout">
        <div className="faq-header-col"><h2 className="faq-heading">Frequently Asked<br/>Questions</h2></div>
        <div className="faq-list-col">
          {[
            {q:'What is Kaamos?',a:'Kaamos is the OTC settlement rail for digital assets. We enable regulatory-compliant, direct institutional settlement across Cardano and Midnight chains using atomic hash-time-locked contracts. Think of it as institutional-grade bilateral settlement without the intermediary.'},
            {q:'How does the atomic swap work?',a:"Both parties lock assets into smart contract escrows on their respective chains. The swap executes atomically — both transfers succeed or both fail. Hash-time-locked contracts ensure that if one party doesn't fulfil within the time window, all assets are returned to their owners."},
            {q:'What about compliance?',a:'Kaamos enforces compliance at the protocol level. Counterparty selection is filtered by regulatory jurisdiction — FINMA, EU MiCA, UK FCA, HK SFC, and more. Our Midnight integration enables ZK-based KYB proofs, allowing institutions to prove compliance without revealing sensitive corporate data.'},
            {q:'What trading pairs are supported?',a:'Currently, Kaamos supports Cardano USDM ↔ Midnight USDC cross-chain swaps on Preprod testnet. Additional stablecoin pairs and chain integrations are on our roadmap as the Midnight ecosystem evolves.'},
          ].map((f,i) => (
            <div className="faq-item" key={i}>
              <button className="faq-question" aria-expanded="false"><span className="faq-toggle" /><h3>{f.q}</h3></button>
              <div className="faq-answer"><p>{f.a}</p></div>
            </div>
          ))}
        </div>
      </div></div></section>

      {/* Newsletter */}
      <section className="newsletter-section"><div className="container"><div className="newsletter-block">
        <div className="newsletter-text"><p className="newsletter-tagline">Stay ahead of the curve.</p></div>
        <form className="newsletter-form" onSubmit={e => { e.preventDefault(); const btn = (e.target as HTMLFormElement).querySelector('.newsletter-btn') as HTMLButtonElement; btn.textContent = 'Subscribed ✓'; btn.style.background = '#22c55e'; setTimeout(() => { btn.textContent = 'Notify Me →'; btn.style.background = ''; }, 3000); }}>
          <p className="newsletter-form-label">Email</p>
          <div className="newsletter-input-row">
            <input type="email" placeholder="you@institution.com" required />
            <button type="submit" className="newsletter-btn">Notify Me →</button>
          </div>
        </form>
      </div></div></section>

      {/* Footer */}
      <footer className="footer"><div className="container">
        <div className="footer-inner">
          <div className="footer-left">
            <a href="#" className="logo"><img src="/kaamos-full.png" alt="Kaamos" className="logo-img" /><img src="/kaamos-wordmark.png" alt="KAAMOS" className="logo-wordmark" /></a>
            <p className="footer-desc">Building the future of private, cross-chain institutional liquidity. Atomic settlement on Cardano × Midnight.</p>
            <div className="footer-social">
              <a href="https://twitter.com" className="social-link" target="_blank" rel="noreferrer" aria-label="Twitter"><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>
              <a href="https://github.com/kaleababayneh/midswap-otc" className="social-link" target="_blank" rel="noreferrer" aria-label="GitHub"><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg></a>
            </div>
          </div>
          <div className="footer-right">
            <div className="footer-col"><p className="footer-col-title">Resources</p><ul><li><a href="#overview">Overview</a></li><li><a href="#product">Product</a></li><li><a href="#features">Features</a></li><li><a href="#faq">FAQ</a></li></ul></div>
            <div className="footer-col"><p className="footer-col-title">Developers</p><ul><li><a href="https://github.com/kaleababayneh/midswap-otc" target="_blank" rel="noreferrer">GitHub</a></li><li><a href="https://docs.midnight.network" target="_blank" rel="noreferrer">Documentation</a></li></ul></div>
            <div className="footer-col"><p className="footer-col-title">Company</p><ul><li><a href="#">Privacy</a></li><li><a href="#">Terms</a></li><li><a href="#">Contact</a></li></ul></div>
          </div>
        </div>
        <div className="footer-bottom"><p>© 2025 Kaamos. All rights reserved.</p></div>
      </div></footer>
    </div>
  );
};
