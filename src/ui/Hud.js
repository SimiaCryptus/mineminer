export function fmtTime(ms) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    const tenths = Math.floor((ms % 1000) / 100);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}

export function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[c]);
}

/** Plain-DOM heads-up display layered over the canvas. */
export class Hud {
    constructor(root, handlers) {
        this.h = handlers;
        this.el = document.createElement('div');
        this.el.className = 'hud';
        this.el.innerHTML = `
      <div class="hud-tl">
        <div class="mines-ring"><div class="mines-count">0</div></div>
        <div class="hud-stack">
          <div class="timer">00:00.0</div>
          <div class="lives"></div>
           <div class="collapses" title="Quantum collapses spent (Ψ) · quantum lives left"></div>
          <div class="level-name"></div>
        </div>
      </div>
      <div class="hud-tr">
         <button class="btn theme" title="Next colour theme (T · Shift+T for previous)">🎨</button>
        <button class="btn gear" title="Pause / vault &amp; settings (Space)">⚙</button>
      </div>
      <div class="hud-bc">
        <button class="btn touch-mode hidden" title="Tap action">⛏</button>
        <div class="hint"></div>
      </div>
      <div class="flash"></div>
      <div class="crosshair"></div>
    `;
        root.appendChild(this.el);
        const q = (sel) => this.el.querySelector(sel);
        this.minesEl = q('.mines-count');
        this.ringEl = q('.mines-ring');
        this.timerEl = q('.timer');
        this.livesEl = q('.lives');
        this.collapsesEl = q('.collapses');
        this.levelEl = q('.level-name');
        this.touchBtn = q('.touch-mode');
        this.hintEl = q('.hint');
        this.flashEl = q('.flash');

        q('.gear').addEventListener('click', () => this.h.onSettings());
         q('.theme').addEventListener('click', (e) => this.h.onTheme?.(e.shiftKey ? -1 : 1));
        this.touchBtn.addEventListener('click', () => this.h.onTouchMode());
        if ('ontouchstart' in window || navigator.maxTouchPoints > 0) this.touchBtn.classList.remove('hidden');
    }

    setLevel(name, seed) {
        this.levelEl.innerHTML = `${esc(name)} · <code>${esc(seed)}</code>`;
    }

    setMines(n) {
        this.minesEl.textContent = String(n);
    }

    setProgress(frac) {
        this.ringEl.style.setProperty('--p', String(Math.round(frac * 100)));
    }

    setLives(n) {
        this.livesEl.textContent = n === Infinity ? '⛏ ∞' : '⛏'.repeat(Math.max(0, n));
    }

    /**
     * Decoherence counter: collapses spent, and how many quantum lives are left before
     * grace switches off and the classical lives start paying.
     */
    setQuantum(used, left = Infinity, show = true) {
        if (!show && used === 0) {
            this.collapsesEl.textContent = '';
            return;
        }
        const remaining = left === Infinity ? '∞' : String(Math.max(0, left));
        this.collapsesEl.textContent = `Ψ ${used} · ${remaining} left`;
        this.collapsesEl.classList.toggle('spent', left !== Infinity && left <= 0);
    }

    setTime(ms) {
        const text = fmtTime(ms);
        if (this.timerEl.textContent !== text) this.timerEl.textContent = text;
    }

    setLayers(count) {
        let html = `<button class="btn" data-layer="-1" title="All layers (0)">0</button>`;
        for (let y = 0; y < count; y++) {
            html += `<button class="btn" data-layer="${y}" title="Isolate layer ${y + 1}">${y + 1}</button>`;
        }
    }

    setLayer(y) {
    }

    setCameraMode(mode) {
         if (!this.camBtn) return;
        this.camBtn.textContent = mode === 'miner' ? '⛏ Miner' : '🎥 Orbit';
    }

    setTouchMode(mode) {
        this.touchBtn.textContent = mode === 'mark' ? '🚩' : '⛏';
    }

    setHint(text) {
        this.hintEl.textContent = text;
    }

    flash(text, ms = 1800) {
        this.flashEl.textContent = text;
        this.flashEl.classList.add('show');
        clearTimeout(this.flashTimer);
        this.flashTimer = setTimeout(() => this.flashEl.classList.remove('show'), ms);
    }
}