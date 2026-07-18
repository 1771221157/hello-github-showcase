/**
 * 星穹开源 · app.js
 * 双色粒子场 · 主题切换 · 搜索过滤 · 加载更多
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════
     Particle Canvas — Cyan + Purple dual-color field
     ═══════════════════════════════════════════════════════ */
  const canvas = document.getElementById('particles-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let particles = [];
    let animId;
    let mouseX = -1000, mouseY = -1000;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    function createParticles() {
      const count = Math.min(Math.floor(window.innerWidth * 0.07), 120);
      particles = [];
      const colors = [
        { r: 0, g: 229, b: 255 },   // cyan
        { r: 139, g: 92, b: 246 },   // purple
        { r: 77, g: 240, b: 255 },   // soft cyan
      ];

      for (let i = 0; i < count; i++) {
        const color = colors[Math.floor(Math.random() * colors.length)];
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: Math.random() * 1.6 + 0.4,
          vx: (Math.random() - 0.5) * 0.25,
          vy: (Math.random() - 0.5) * 0.25,
          alpha: Math.random() * 0.4 + 0.15,
          pulse: Math.random() * Math.PI * 2,
          pulseSpeed: 0.008 + Math.random() * 0.015,
          color,
        });
      }
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.pulse += p.pulseSpeed;

        // Mouse interaction — gentle repulsion
        const dx = p.x - mouseX;
        const dy = p.y - mouseY;
        const mouseDist = Math.sqrt(dx * dx + dy * dy);
        if (mouseDist < 150 && mouseDist > 0) {
          const force = (150 - mouseDist) / 150 * 0.15;
          p.vx += (dx / mouseDist) * force;
          p.vy += (dy / mouseDist) * force;
          p.vx *= 0.98; p.vy *= 0.98;
        }

        // Boundary wrap
        if (p.x < -20) p.x = canvas.width + 20;
        if (p.x > canvas.width + 20) p.x = -20;
        if (p.y < -20) p.y = canvas.height + 20;
        if (p.y > canvas.height + 20) p.y = -20;

        const alpha = Math.max(0, Math.min(0.7, p.alpha + Math.sin(p.pulse) * 0.2));
        const { r, g, b } = p.color;

        // Draw particle with glow
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.fill();

        // Inner glow for larger particles
        if (p.r > 1.1) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 2.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.12})`;
          ctx.fill();
        }

        // Connection lines between nearby particles of same color
        for (const q of particles) {
          if (q === p || q.color.r !== p.color.r) continue;
          const cdx = p.x - q.x;
          const cdy = p.y - q.y;
          const dist = Math.sqrt(cdx * cdx + cdy * cdy);
          if (dist < 110) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(${r},${g},${b},${0.035 * (1 - dist / 110)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      animId = requestAnimationFrame(draw);
    }

    resize();
    createParticles();
    draw();

    window.addEventListener('resize', () => { resize(); createParticles(); });
    window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
    window.addEventListener('mouseleave', () => { mouseX = -1000; mouseY = -1000; });
  }

  /* ═══════════════════════════════════════════════════════
     Theme Toggle
     ═══════════════════════════════════════════════════════ */
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    const html = document.documentElement;
    const saved = localStorage.getItem('theme');
    if (saved) {
      html.dataset.theme = saved;
    } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      html.dataset.theme = 'light';
    }

    themeToggle.addEventListener('click', () => {
      const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
      html.dataset.theme = next;
      localStorage.setItem('theme', next);
    });

    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
      if (!localStorage.getItem('theme')) {
        html.dataset.theme = e.matches ? 'light' : 'dark';
      }
    });
  }

  /* ═══════════════════════════════════════════════════════
     Header Scroll
     ═══════════════════════════════════════════════════════ */
  const header = document.getElementById('site-header');
  if (header) {
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          header.classList.toggle('scrolled', window.scrollY > 50);
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  /* ═══════════════════════════════════════════════════════
     Project Search
     ═══════════════════════════════════════════════════════ */
  const searchInput = document.getElementById('project-search');
  const projectGrid = document.getElementById('project-grid');
  if (searchInput && projectGrid) {
    searchInput.addEventListener('input', debounce(function () {
      const query = this.value.toLowerCase().trim();
      const cards = projectGrid.querySelectorAll('.project-card-wrapper');
      cards.forEach(card => {
        card.style.display = (!query || card.textContent.toLowerCase().includes(query)) ? '' : 'none';
      });
      const loadMoreBtn = document.getElementById('load-more-btn');
      if (loadMoreBtn) loadMoreBtn.style.display = query ? 'none' : '';
    }, 200));
  }

  /* ═══════════════════════════════════════════════════════
     Load More
     ═══════════════════════════════════════════════════════ */
  const loadMoreBtn = document.getElementById('load-more-btn');
  if (loadMoreBtn) {
    const grid = document.getElementById('project-grid');
    const remainingSpan = document.getElementById('remaining-count');
    const BATCH = 30;

    loadMoreBtn.addEventListener('click', () => {
      const hidden = grid.querySelectorAll('.project-card--hidden');
      Array.from(hidden).slice(0, BATCH).forEach(el => el.classList.remove('project-card--hidden'));
      const stillHidden = grid.querySelectorAll('.project-card--hidden').length;
      if (remainingSpan) remainingSpan.textContent = stillHidden;
      if (stillHidden === 0) loadMoreBtn.style.display = 'none';
    });
  }

  /* ═══════════════════════════════════════════════════════
     Utility
     ═══════════════════════════════════════════════════════ */
  function debounce(fn, delay) {
    let timer;
    return function () {
      const ctx = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(ctx, args), delay);
    };
  }
})();
