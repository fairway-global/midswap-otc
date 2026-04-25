/**
 * Arcana-faithful CSS for the Kaamos landing page.
 *
 * This replicates the exact arcana style.css class structure and layout,
 * adapted with Kaamos brand tokens (teal accent, JetBrains Mono).
 * Injected as a <style> element by the LandingPage React component.
 */

const LANDING_CSS = `
/* === BASE TOKENS === */
.klp *,.klp *::before,.klp *::after{box-sizing:border-box;margin:0;padding:0}
.klp {
  --bg:#000000;--bg-card:rgba(255,255,255,0.03);--bg-card-hover:rgba(255,255,255,0.06);
  --white:#ffffff;--text:#ffffffcc;--text-muted:#ffffff66;--text-dim:#ffffff33;
  --accent:#2DD4BF;--accent-dim:rgba(45,212,191,0.15);--accent-glow:rgba(45,212,191,0.4);
  --border:rgba(255,255,255,0.08);--border-light:rgba(255,255,255,0.12);
  --font-sans:'Inter','InterVariable',-apple-system,sans-serif;
  --font-mono:'JetBrains Mono','SF Mono',ui-monospace,monospace;
  --ease-out:cubic-bezier(0.16,1,0.3,1);--ease-bounce:cubic-bezier(0.34,1.56,0.64,1);
  font-family:var(--font-mono);background:var(--bg);color:var(--text);line-height:1.6;overflow-x:hidden;
}
.klp a{color:inherit;text-decoration:none}
.klp ul{list-style:none}
.klp img{max-width:100%;display:block}
.klp .container{max-width:1200px;margin:0 auto;padding:0 24px}
@media(min-width:640px){.klp .container{padding:0 40px}}

/* === BUTTONS === */
.klp .btn{display:inline-block;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:500;transition:all .25s var(--ease-out);cursor:pointer;border:none;font-family:var(--font-mono)}
.klp .btn-primary{background:var(--white);color:var(--bg)}
.klp .btn-primary:hover{background:#e5e5e5;transform:translateY(-1px)}
.klp .btn-ghost{color:rgba(255,255,255,.85);text-decoration:underline;text-underline-offset:4px;text-decoration-color:rgba(255,255,255,.4);padding:10px 0}
.klp .btn-ghost:hover{color:var(--white);text-decoration-color:rgba(255,255,255,.8)}
.klp .btn-white{background:var(--white);color:var(--bg);padding:14px 32px;border-radius:50px;font-size:14px;font-weight:500}
.klp .btn-white:hover{background:#f0f0f0;transform:translateY(-1px)}
.klp .btn-glow{animation:klp-pulse-glow 2.5s ease-in-out infinite 1.5s}
@keyframes klp-pulse-glow{0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}50%{box-shadow:0 0 20px 4px rgba(255,255,255,.15)}}

/* === TOP BANNER === */
.klp .top-banner{position:absolute;top:0;left:0;right:0;z-index:50;display:flex;justify-content:center}
.klp .top-banner-inner{min-width:1000px;margin:0 auto;border-radius:0 0 12px 12px;background:rgba(255,255,255,.06);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 24px;font-size:13px}
.klp .top-banner-text{color:rgba(255,255,255,.7)}
.klp .top-banner-link{font-weight:500;color:var(--white);transition:opacity .2s;cursor:pointer}
.klp .top-banner-link:hover{opacity:.8}
@media(min-width:640px){.klp .top-banner-inner{padding:14px 32px;font-size:14px}}

/* === HEADER === */
.klp .header{position:absolute;top:41px;left:0;right:0;z-index:40}
.klp .nav-container{display:flex;align-items:center;justify-content:space-between;padding:16px 16px}
@media(min-width:640px){.klp .nav-container{padding:20px 32px}}
@media(min-width:1024px){.klp .nav-container{padding:20px 40px}}
.klp .logo{display:flex;align-items:center;gap:4px;font-size:20px;color:var(--white);flex-shrink:0}
.klp .logo-img{height:200px;width:auto;margin:-60px -30px -80px -20px}
.klp .logo-img--small{height:60px;margin:-12px -8px -12px -4px}
.klp .logo-wordmark{height:40px;width:auto}
.klp .logo-wordmark--small{height:26px}
.klp .logo-text{font-family:var(--font-mono);font-weight:700;letter-spacing:.14em;font-size:.95rem;text-transform:uppercase}
.klp .logo--small .logo-text{font-size:.8rem}
.klp .nav-links{display:none;position:absolute;left:50%;transform:translateX(-50%)}
.klp .nav-links a{font-size:15px;color:rgba(255,255,255,.7);transition:color .2s;padding:8px 0}
.klp .nav-links a:hover{color:var(--white)}
@media(min-width:768px){.klp .nav-links{display:flex;gap:40px}}
.klp .nav-cta{display:none;border-radius:8px;background:var(--white);padding:8px 20px;font-size:13px;font-weight:500;color:var(--bg);transition:all .2s;font-family:var(--font-mono)}
.klp .nav-cta:hover{background:#e5e5e5}
@media(min-width:768px){.klp .nav-cta{display:inline-block}}

/* === STICKY NAV === */
.klp .sticky-nav{position:fixed;top:12px;left:12px;right:12px;z-index:999;opacity:0;transform:translateY(-16px);pointer-events:none;transition:all .5s var(--ease-out)}
.klp .sticky-nav.visible{opacity:1;transform:translateY(0);pointer-events:auto}
.klp .sticky-nav-inner{display:flex;align-items:center;justify-content:space-between;height:56px;border-radius:16px;background:var(--bg);padding:0 24px;box-shadow:0 4px 30px rgba(0,0,0,.5),0 0 0 1px var(--border)}
.klp .sticky-nav-links{display:none;flex:1;justify-content:center;gap:32px}
.klp .sticky-nav-links a{font-size:15px;color:var(--white);padding:8px 12px;border-radius:8px;transition:background .2s}
.klp .sticky-nav-links a:hover{background:rgba(255,255,255,.1)}
@media(min-width:768px){.klp .sticky-nav-inner{width:780px;margin:0 auto}.klp .sticky-nav-links{display:flex}.klp .sticky-nav{left:50%;right:auto;transform:translateX(-50%) translateY(-16px)}.klp .sticky-nav.visible{transform:translateX(-50%) translateY(0)}}
.klp .nav-cta--small{display:inline-block;border-radius:10px;padding:8px 14px;font-size:14px}

/* === HERO === */
.klp .hero{position:relative;min-height:100dvh;display:flex;flex-direction:column;justify-content:center;overflow:hidden}
.klp .hero-bg{position:absolute;inset:0;z-index:0}
.klp .hero-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;z-index:0}
.klp .hero-video-overlay{position:absolute;inset:0;background:rgba(0,0,0,0.6);z-index:1}
.klp .hero-video-gradient{position:absolute;inset:0;background:linear-gradient(to top,#000000 0%,transparent 40%,rgba(0,0,0,0.3) 100%);z-index:2}
.klp .hero-content{position:relative;z-index:10;display:flex;align-items:center;width:100%;max-width:1200px;margin:0 auto;padding:0 24px;min-height:100dvh}
@media(min-width:640px){.klp .hero-content{padding:0 40px}}
.klp .hero-text-block{max-width:680px;margin-left:auto;padding-right:0}
@media(min-width:640px){.klp .hero-text-block{padding-right:24px}}
.klp .hero-title{font-family:var(--font-sans);font-weight:300;font-size:clamp(2.2rem,5vw,4.2rem);line-height:1.1;letter-spacing:-.02em}
.klp .hero-rotating-wrapper{display:block;height:1.2em;overflow:hidden;perspective:600px}
.klp .hero-rotating-text{display:inline-block;color:var(--white);transform-origin:center bottom;transition:all .4s var(--ease-out)}
.klp .hero-static-text{display:block;color:var(--white)}
.klp .hero-subtitle{margin-top:32px;max-width:520px;font-size:15px;line-height:1.7;color:var(--text)}
.klp .hero-actions{margin-top:28px;display:flex;align-items:center;gap:24px}
.klp .hero-partners{position:absolute;bottom:48px;left:0;right:0;z-index:10}
.klp .marquee{overflow:hidden;padding:20px 0}
.klp .marquee-track{display:flex;gap:48px;align-items:center;width:max-content;animation:klp-scroll 25s linear infinite}
@media(min-width:640px){.klp .marquee-track{gap:64px}}
.klp .marquee-track span{font-size:14px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.25);white-space:nowrap;font-weight:500}
.klp .marquee-track img{height:22px;width:auto;opacity:.35;filter:grayscale(1) brightness(2)}
.klp .marquee-track img.round{border-radius:50%;height:26px}
@keyframes klp-scroll{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}

/* === STATS SECTION === */
.klp .stats-section{background:var(--bg);padding:112px 0;scroll-margin-top:48px}
.klp .stats-grid{display:grid;grid-template-columns:1fr;gap:48px;margin-bottom:80px}
@media(min-width:1024px){.klp .stats-grid{grid-template-columns:1fr 1fr;gap:48px}}
.klp .stat-block{position:relative;text-align:center}
.klp .stat-bg-text{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:clamp(5rem,10vw,10rem);font-weight:300;color:rgba(255,255,255,.025);pointer-events:none;user-select:none}
.klp .stat-block .stat-label{font-size:12px;text-transform:uppercase;letter-spacing:.2em;color:rgba(255,255,255,.4);margin-bottom:24px}
.klp .stat-value{font-size:clamp(2.5rem,5vw,4.5rem);font-weight:300;color:var(--white);position:relative}
.klp .stat-desc{margin-top:16px;font-size:16px;color:rgba(255,255,255,.4);max-width:400px;margin-left:auto;margin-right:auto}

/* Pillars */
.klp .pillars{display:grid;grid-template-columns:1fr;gap:1px;background:rgba(255,255,255,.06);border-radius:16px;overflow:hidden}
@media(min-width:768px){.klp .pillars{grid-template-columns:repeat(3,1fr)}}
.klp .pillar-card{background:var(--bg-card);padding:40px;transition:background .3s}
.klp .pillar-card:hover{background:var(--bg-card-hover)}
.klp .pillar-fig{font-size:12px;text-transform:uppercase;letter-spacing:.2em;color:rgba(255,255,255,.3);margin-bottom:32px}
.klp .pillar-icon-area{display:flex;align-items:center;justify-content:center;height:120px;margin-bottom:32px}
.klp .pillar-icon-area svg{width:64px;height:64px}
.klp .pillar-title{font-size:16px;font-weight:600;color:var(--white);margin-bottom:8px}
.klp .pillar-desc{font-size:14px;color:rgba(255,255,255,.5);line-height:1.7}

/* Bridge */
.klp .section-bridge{margin-top:64px;display:flex;flex-direction:column;align-items:center}
.klp .bridge-line{height:1px;width:128px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)}
.klp .bridge-text{margin-top:24px;font-size:20px;font-weight:300;color:var(--white)}

/* === PRODUCT SECTION === */
.klp .product-section{background:var(--bg);padding:0 0 16px;scroll-margin-top:48px}
.klp .product-header{max-width:640px;margin-bottom:64px}
.klp .section-tag{font-size:12px;text-transform:uppercase;letter-spacing:.2em;color:rgba(255,255,255,.4);margin-bottom:16px}
.klp .section-title{font-size:clamp(1.8rem,3.5vw,3rem);font-weight:300;color:var(--white);margin-bottom:24px}
.klp .section-desc{color:rgba(255,255,255,.5);line-height:1.7;font-size:15px}
.klp .product-cards{display:grid;gap:1px;background:rgba(255,255,255,.04);border-radius:16px;overflow:hidden;margin-bottom:48px}
@media(min-width:768px){.klp .product-cards{grid-template-columns:repeat(3,1fr)}}
.klp .product-card{background:var(--bg-card);padding:40px;transition:background .3s}
.klp .product-card:hover{background:var(--bg-card-hover)}
.klp .product-card h3{font-size:17px;font-weight:500;color:var(--white);margin-bottom:12px}
.klp .product-card p{font-size:14px;color:rgba(255,255,255,.5);line-height:1.7}

/* Vault Card */
.klp .vault-card{margin-top:48px}
.klp .vault-card-inner{border-radius:24px;border:1px solid rgba(255,255,255,.1);background:linear-gradient(180deg,rgba(255,255,255,0.04) 0%,var(--bg) 100%);overflow:hidden}
.klp .vault-header{padding:32px 40px 24px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.klp .vault-name{font-size:clamp(1.5rem,3vw,2.2rem);font-weight:600;color:var(--white);letter-spacing:-.01em}
.klp .vault-subtitle{margin-top:8px;font-size:15px;color:rgba(255,255,255,.4)}
.klp .vault-divider{margin:0 40px;height:1px;background:rgba(255,255,255,.08)}
.klp .vault-params{display:grid;grid-template-columns:repeat(2,1fr);gap:20px;padding:24px 40px}
@media(min-width:640px){.klp .vault-params{grid-template-columns:repeat(4,1fr)}}
.klp .vault-param-label{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--accent-glow);margin-bottom:6px}
.klp .vault-param-value{font-size:14px;font-weight:500;color:var(--white)}
.klp .vault-metrics{display:grid;grid-template-columns:repeat(3,1fr);padding:40px;text-align:center}
.klp .vault-metric-value{font-size:clamp(1.5rem,3.5vw,3.2rem);font-weight:300;color:var(--accent);letter-spacing:-.01em}
.klp .vault-metric-label{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:rgba(255,255,255,.4);margin-top:8px}

/* === FEATURES SECTION === */
.klp .features-section{background:var(--bg);padding:112px 0;scroll-margin-top:48px}
.klp .features-header{text-align:left;margin-bottom:48px}
.klp .features-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:24px;margin-bottom:80px;max-width:900px;margin-left:auto;margin-right:auto}
@media(min-width:640px){.klp .features-stats{grid-template-columns:repeat(4,1fr);gap:48px}}
.klp .feature-stat{text-align:center}
.klp .feature-stat-value{font-size:clamp(1.8rem,3vw,2.8rem);font-weight:300;color:var(--white)}
.klp .feature-stat-label{margin-top:12px;font-size:13px;color:rgba(255,255,255,.4)}
@media(min-width:640px){.klp .feature-stat+.feature-stat{border-left:1px solid var(--border)}}

/* CTA Block */
.klp .cta-block{position:relative;border-radius:24px;overflow:hidden;min-height:50vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:80px 32px}
.klp .cta-bg{position:absolute;inset:0;z-index:0;overflow:hidden}
.klp .cta-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;z-index:0}
.klp .cta-video-overlay{position:absolute;inset:0;background:rgba(0,0,0,0.6);z-index:1}
.klp .cta-content{position:relative;z-index:3}
.klp .cta-content h2{font-size:clamp(1.5rem,3vw,2.2rem);font-weight:300;color:var(--white);margin-bottom:20px}
.klp .cta-content p{max-width:520px;margin:0 auto 32px;color:rgba(255,255,255,.7);font-size:15px}

/* === FAQ SECTION === */
.klp .faq-section{background:var(--bg);padding:80px 0 40px;scroll-margin-top:48px}
.klp .faq-layout{display:flex;flex-direction:column;gap:48px;max-width:1000px;margin:0 auto;padding-top:80px;border-top:1px solid var(--border)}
@media(min-width:1024px){.klp .faq-layout{flex-direction:row;align-items:flex-start}}
.klp .faq-header-col{flex:0 0 40%}
@media(min-width:1024px){.klp .faq-header-col{position:sticky;top:120px}}
.klp .faq-heading{font-family:var(--font-sans);font-size:clamp(1.5rem,3vw,2.5rem);font-weight:300;color:var(--white)}
.klp .faq-list-col{flex:1}
.klp .faq-item{border-bottom:2px solid rgba(255,255,255,.04);margin-bottom:4px}
.klp .faq-question{display:flex;align-items:center;padding:24px 16px;background:none;border:none;cursor:pointer;width:100%;text-align:left;color:var(--white);font-family:inherit}
.klp .faq-question h3{font-size:clamp(1rem,1.5vw,1.4rem);font-weight:500;margin:0;transition:color .2s}
.klp .faq-question:hover h3{color:var(--accent)}
.klp .faq-toggle{position:relative;width:16px;height:16px;margin-right:20px;flex-shrink:0}
.klp .faq-toggle::before,.klp .faq-toggle::after{content:'';position:absolute;background:var(--accent);transition:transform .4s ease}
.klp .faq-toggle::before{top:50%;left:0;width:100%;height:2px;transform:translateY(-50%)}
.klp .faq-toggle::after{top:0;left:50%;width:2px;height:100%;transform:translateX(-50%)}
.klp .faq-item.expanded .faq-toggle::after{transform:translateX(-50%) rotate(90deg)}
.klp .faq-item.expanded .faq-question:hover h3{color:var(--white)}
.klp .faq-answer{max-height:0;overflow:hidden;opacity:0;transition:max-height .5s ease,opacity .4s ease}
.klp .faq-answer p{padding:0 16px 24px 52px;font-size:15px;color:rgba(255,255,255,.5);line-height:1.7}
.klp .faq-item.expanded .faq-answer{max-height:400px;opacity:1}

/* === NEWSLETTER === */
.klp .newsletter-section{background:var(--bg);padding:80px 0}
.klp .newsletter-block{display:flex;flex-direction:column;gap:32px;max-width:1100px;margin:0 auto;align-items:center}
@media(min-width:768px){.klp .newsletter-block{flex-direction:row;align-items:center;justify-content:space-between}}
.klp .newsletter-tagline{font-size:clamp(1.1rem,1.8vw,1.35rem);font-weight:500;font-style:italic;color:var(--white);max-width:400px;line-height:1.4}
.klp .newsletter-form{width:100%;max-width:500px;padding:40px;border-radius:20px;background:rgba(255,255,255,.04)}
.klp .newsletter-form-label{font-size:14px;font-weight:500;color:var(--white);margin-bottom:12px}
.klp .newsletter-input-row{display:flex}
.klp .newsletter-input-row input{flex:1;padding:12px 20px;border:none;border-right:1.5px solid var(--border);background:var(--bg);font-family:var(--font-sans);font-size:14px;color:var(--white);outline:none;border-radius:50px 0 0 50px}
.klp .newsletter-input-row input::placeholder{color:var(--text-dim)}
.klp .newsletter-btn{background:var(--accent);color:var(--white);border:none;padding:12px 20px;font-family:var(--font-sans);font-size:14px;font-weight:500;border-radius:0 50px 50px 0;cursor:pointer;transition:background .2s}
.klp .newsletter-btn:hover{background:#14B8A6}

/* === FOOTER === */
.klp .footer{background:var(--bg);padding:50px 0 80px}
.klp .footer-inner{display:flex;flex-direction:column;gap:48px}
@media(min-width:768px){.klp .footer-inner{flex-direction:row;justify-content:space-between}}
.klp .footer-left{max-width:400px}
.klp .footer-desc{margin:16px 0 40px;font-size:12px;color:var(--text-dim);line-height:1.6}
.klp .footer-social{display:flex;gap:20px}
.klp .social-link{color:rgba(255,255,255,.4);transition:color .2s}
.klp .social-link:hover{color:var(--white)}
.klp .social-link svg{width:18px;height:18px}
.klp .footer-right{display:flex;gap:60px;flex-wrap:wrap}
.klp .footer-col-title{font-size:15px;color:var(--white);margin-bottom:16px;font-weight:500}
.klp .footer-col ul li{margin-bottom:12px}
.klp .footer-col ul li a{font-size:13px;color:var(--text-dim);transition:color .2s}
.klp .footer-col ul li a:hover{color:var(--white)}
.klp .footer-bottom{margin-top:48px;padding-top:24px;border-top:1px solid var(--border);font-size:12px;color:var(--text-dim)}

/* === ANIMATIONS === */
.klp [data-animate]{opacity:0;transform:translateY(24px);transition:opacity .7s var(--ease-out),transform .7s var(--ease-out)}
.klp [data-animate].in-view{opacity:1;transform:translateY(0)}

/* === ACCENT TEXT === */
.klp .accent-text{color:var(--accent)}
`;

export default LANDING_CSS;
