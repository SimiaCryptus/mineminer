import {esc, fmtTime} from './Hud.js';
import {LIVES_OPTIONS, QUANTUM_LIVES_OPTIONS} from '../core/settings.js';
import {CUSTOM_LIMITS} from '../game/LevelDefs.js';
import {neighbourCount, TESSELLATIONS} from '../game/Tessellation.js';

const WEIGHT_OPTS = [['1', 'Counts as 1'], ['0.5', 'Counts as ½'], ['0', 'Ignored']];


function select(name, label, options, value, disabled = false) {
    const opts = options
        .map(([v, text]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${text}</option>`)
        .join('');
    return `<label class="row"><span>${label}</span><select name="${name}" ${disabled ? 'disabled' : ''}>${opts}</select></label>`;
}

function check(name, label, value) {
    return `<label class="row"><span>${label}</span><input type="checkbox" name="${name}" ${value ? 'checked' : ''}></label>`;
}

function number(name, label, value, min, max) {
    const lim = `min="${min}" ${max != null ? `max="${max}"` : ''}`;
    return `<label class="row"><span>${label}</span><input type="number" name="${name}" ${lim} value="${value}"></label>`;
}

/** Pause/settings and end-of-run panels. Emits (act, data) via handlers.onAction. */
export class Overlay {
    constructor(root, handlers) {
        this.h = handlers;
        this.mode = null;
        this.current = null;
        this.el = document.createElement('div');
        this.el.className = 'overlay hidden';
        this.panel = document.createElement('div');
        this.panel.className = 'panel';
        this.el.appendChild(this.panel);
        root.appendChild(this.el);

        this.el.addEventListener('click', (e) => {
            if (e.target === this.el && this.mode !== 'end') this.hide();
        });
        this.panel.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-act]');
            if (!btn) return;
            const act = btn.dataset.act;
            const data = {...btn.dataset};
            if (act === 'dig') {
                const form = this.panel.querySelector('form.settings');
                data.seed = form?.seed?.value ?? '';
                data.settings = form ? this.readSettings(form) : this.current;
            }
            this.h.onAction(act, data);
        });
        // Enter inside a number field must never reload the page.
        this.panel.addEventListener('submit', (e) => e.preventDefault());
        this.panel.addEventListener('change', (e) => {
            const form = e.target.closest('form.settings');
            if (form && e.target.name !== 'seed') this.h.onSettingsChange(this.readSettings(form));
        });
        this.panel.addEventListener('input', (e) => {
            if (e.target.name === 'volume') this.h.onSettingsChange(this.readSettings(e.target.form));
        });
    }

    isOpen() {
        return !this.el.classList.contains('hidden');
    }

    open(mode, html) {
        this.mode = mode;
        this.panel.innerHTML = html;
        this.el.classList.remove('hidden');
    }

    hide() {
        if (!this.isOpen()) return;
        this.el.classList.add('hidden');
        this.mode = null;
        this.h.onClose?.();
    }

    readSettings(form) {
        const fd = new FormData(form);
        // Disabled selects (a weight class the current shape does not have) are not
        // submitted; keep whatever the player had.
        const weight = (name) => (fd.has(name) ? Number(fd.get(name)) : this.current[name]);
        return {
            ...this.current,
            tessellation: fd.get('tessellation'),
            boardW: Number(fd.get('boardW')),
            boardD: Number(fd.get('boardD')),
            boardH: Number(fd.get('boardH')),
            boardMines: Number(fd.get('boardMines')),
            cascade: fd.get('cascade'),
            quantumLives: fd.get('quantumLives'),
            edgeWeight: weight('edgeWeight'),
            cornerWeight: weight('cornerWeight'),
            lives: fd.get('lives'),
            safeFirstStrike: form.safeFirstStrike.checked,
            strictMarks: form.strictMarks.checked,
            undo: form.undo.checked,
            hideSatisfied: form.hideSatisfied.checked,
            colourblind: form.colourblind.checked,
            reducedMotion: form.reducedMotion.checked,
            effects: fd.get('effects'),
            volume: Number(fd.get('volume')),
        };
    }

    showSettings(settings, ctx) {
        this.current = settings;
        const cls = ctx.tess.classes;
        const weightLabel = (what, n) => (n ? `${what} neighbours (${n})` : `${what} neighbours (none in this shape)`);
        const shapes = TESSELLATIONS.map((t) => [t.id, `${t.name} · ${neighbourCount(t)} neighbours`]);
        const {min, max} = CUSTOM_LIMITS;
        this.open('settings', `
      <h2>Paused · Settings</h2>
      <form class="settings">
        <h3>Vault</h3>
        ${select('tessellation', 'Cell shape', shapes, settings.tessellation)}
        <div class="grid">
          ${number('boardW', 'Width', settings.boardW, min, max)}
          ${number('boardD', 'Depth', settings.boardD, min, max)}
          ${number('boardH', 'Height (layers)', settings.boardH, 1, max)}
          ${number('boardMines', 'Mines', settings.boardMines, 1)}
        </div>
        <label class="row"><span>Seed</span><input type="text" name="seed" placeholder="random"></label>
        <div class="actions">
          <button type="button" class="btn primary" data-act="dig">Dig new vault</button>
          <span class="sub">Current: <code>${esc(ctx.tess.name)}</code> seed <code>${esc(ctx.seed)}</code></span>
        </div>
        <h3>Rules</h3>
        ${select('cascade', 'Cascade', [['on', 'On'], ['off', 'Off'], ['single-layer', 'Single layer']], settings.cascade)}
        ${select('quantumLives', 'Quantum lives (Ψ)', QUANTUM_LIVES_OPTIONS, settings.quantumLives)}
        ${select('edgeWeight', weightLabel('Edge', cls.edge), WEIGHT_OPTS, settings.edgeWeight, !cls.edge)}
        ${select('cornerWeight', weightLabel('Corner', cls.corner), WEIGHT_OPTS, settings.cornerWeight, !cls.corner)}
        ${select('lives', 'Lives (mistakes allowed)', LIVES_OPTIONS, settings.lives)}
        ${check('safeFirstStrike', 'Safe first strike', settings.safeFirstStrike)}
        ${check('strictMarks', 'Strict marks (limited to mine count)', settings.strictMarks)}
        ${check('undo', 'Undo (Z)', settings.undo)}
        <h3>Display</h3>
        ${check('hideSatisfied', 'Hide solved numbers', settings.hideSatisfied)}
        ${check('colourblind', 'Colourblind digits (underline 6 / 9)', settings.colourblind)}
        ${check('reducedMotion', 'Reduced motion', settings.reducedMotion)}
        ${select('effects', 'Effects', [['low', 'Low'], ['med', 'Medium'], ['high', 'High']], settings.effects)}
        <label class="row"><span>Volume</span>
          <input type="range" name="volume" min="0" max="1" step="0.05" value="${settings.volume}"></label>
      </form>
      <div class="actions">
        <button class="btn primary" data-act="resume">Resume</button>
        <button class="btn" data-act="restart">Restart (R)</button>
        <button class="btn" data-act="newseed">New seed (N)</button>
        <button class="btn" data-act="copy">Copy link</button>
      </div>
       <p class="sub" style="margin-top:14px">
         The vault can be tiled with cubes (26 neighbours), hexagonal prisms (20), rhombic
         dodecahedra (18) or truncated octahedra (14). Face-touching neighbours always count as 1.
         Edge- and corner-touching neighbours can count as 1, ½ or nothing — half-weights show
         up as numbers like <code>3½</code>. Changing the shape, the weights or either kind of
         lives restarts the current board; size and mine changes take effect when you dig.
       </p>
        <p class="sub">
          Lives are mistakes you survive: each misfire or detonation costs one, and the run ends at
           zero. A flawless run (no misfires, no detonations, no collapses) still earns the extra star.
          “Hide solved numbers” fades out a number once every block around it is cleared or marked
          and the marks add up — it has nothing left to tell you.
        </p>
         <p class="sub">
           <b>Quantum grace</b> removes coin flips. When you mark a block next to revealed numbers
           whose content those numbers do <em>not</em> prove, the vault collapses into a valid world
           where it <em>is</em> a mine (Ψ). Striking such a block collapses the vault into a valid
           world where it is <em>safe</em>. Provable mines still detonate, provably safe marks still
            misfire. A blind dig in the dark is repaired too, by swapping the mine with a block no
            number has seen yet — it only detonates once every remaining dark block is a mine.
         </p>
         <p class="sub">
           <b>Quantum lives</b> are your budget of collapses. Each quantum flag or graced strike
           spends one, and they are spent <em>before</em> your classical lives: once they hit zero
           the vault turns classical again and an ambiguous mine detonates for real. <code>0</code>
           is plain Minesweeper; <code>∞</code> means you never have to guess. A flawless run spends
           none of them.
         </p>
    `);
    }

    showEnd(stats) {
        const cls = stats.won ? 'won' : 'lost';
        const livesLeft = stats.lives === Infinity ? '∞' : stats.lives != null ? String(Math.max(0, stats.lives)) : null;
        const qLeft =
            stats.quantumLives === Infinity
                ? '∞'
                : stats.quantumLives != null
                    ? String(Math.max(0, stats.quantumLives))
                    : null;
        this.open('end', `
      <div class="end ${cls}">
        <h2>${stats.won ? 'Vault cleared!' : 'Detonation'}</h2>
        ${stats.won ? `<div class="stars big">${'★'.repeat(stats.stars)}${'☆'.repeat(3 - stats.stars)}</div>` : ''}
        <dl>
          <dt>Time</dt><dd>${fmtTime(stats.timeMs)}${stats.par ? ` <span class="sub">(par ${fmtTime(stats.par * 1000)})</span>` : ''}</dd>
          ${stats.best != null ? `<dt>Best</dt><dd>${fmtTime(stats.best)}</dd>` : ''}
          <dt>Misfires</dt><dd>${stats.misfires}</dd>
          <dt>Detonations</dt><dd>${stats.detonations}</dd>
           <dt>Collapses</dt><dd>Ψ ${stats.collapses ?? 0}${qLeft !== null ? ` <span class="sub">(${qLeft} left)</span>` : ''}</dd>
           ${livesLeft !== null ? `<dt>Lives left</dt><dd>${livesLeft}</dd>` : ''}
          <dt>Largest cascade</dt><dd>${stats.largestCascade} blocks</dd>
          <dt>Seed</dt><dd><code>${esc(stats.seed)}</code></dd>
        </dl>
        <div class="actions">
          <button class="btn primary" data-act="newseed">New seed (N)</button>
          <button class="btn" data-act="restart">Retry seed (R)</button>
          <button class="btn" data-act="settings">Vault &amp; settings</button>
          <button class="btn" data-act="copy">Copy link</button>
        </div>
      </div>
    `);
    }
}