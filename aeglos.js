/* ============ AEGLOS — reveal, HUD, scroll state ============ */
(function () {
  'use strict';

  /* ---- reveal on scroll ---- */
  const rvEls = Array.from(document.querySelectorAll('.rv'));
  function revealInView() {
    const vh = window.innerHeight;
    for (const el of rvEls) {
      if (el.classList.contains('in')) continue;
      const r = el.getBoundingClientRect();
      if (r.top < vh * 0.9 && r.bottom > 0) el.classList.add('in');
    }
  }
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) e.target.classList.add('in'); });
    }, { threshold: 0.15 });
    rvEls.forEach((el) => io.observe(el));
  }
  window.addEventListener('scroll', revealInView, { passive: true });
  window.addEventListener('resize', revealInView);
  revealInView();

  /* ---- shared scroll state (read by the 3D drone) ---- */
  const PHASES = ['STANDBY', 'THREAT-ASSESS', 'MISSION-PLAN', 'DEPLOY', 'LINK-UP'];
  const SEG_P = [0, 0.22, 0.48, 0.72, 1.0];
  const state = window.AEGLOS = { p: 0, vel: 0, seg: 0 };

  const altFill = document.getElementById('altFill');
  const altKnob = document.getElementById('altKnob');
  const hPhase = document.getElementById('hPhase');
  const hud = document.getElementById('hud');
  const rail = document.querySelector('.alt-rail');
  let railH = rail ? rail.offsetHeight : 0;
  let lastY = window.scrollY;

  function segFor(p) {
    let i = 0;
    while (i < SEG_P.length - 1 && p > SEG_P[i + 1]) i++;
    return i;
  }

  function onScroll() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? window.scrollY / max : 0;
    const dy = window.scrollY - lastY;
    lastY = window.scrollY;
    state.p = p;
    state.vel = Math.min(60, Math.abs(dy));
    state.seg = segFor(p);

    if (altFill) altFill.style.cssText = `bottom:0;top:auto;height:${(p * 100).toFixed(1)}%`;
    if (altKnob) { altKnob.textContent = Math.round(p * 120) + ' M'; altKnob.style.bottom = (p * railH) + 'px'; altKnob.style.top = 'auto'; }
    if (hPhase) hPhase.textContent = PHASES[state.seg];
    if (hud) hud.classList.toggle('on', window.scrollY > window.innerHeight * 0.55);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { railH = rail ? rail.offsetHeight : 0; });
  onScroll();
})();
