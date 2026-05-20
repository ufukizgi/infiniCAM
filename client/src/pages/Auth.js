import { api } from '../api/client.js';
import { toast } from '../modules/Toast.js';

export function renderAuth(container) {
  let isLogin = true;

  function render() {
    container.innerHTML = `
      <div class="auth-page fade-in">
        <!-- Left branding panel -->
        <div class="auth-left">
          <div class="logo" style="margin-bottom:32px; font-size:1.6rem;">
            <div class="logo-icon">∞</div>
            <div class="logo-text">infini<span>CAM</span></div>
          </div>
          <h1 class="auth-brand-title text-center">
            Aluminum Profiles,<br/><span>Infinite</span> Precision.
          </h1>
          <p class="auth-brand-sub">
            Upload your STEP files and get production-ready G-code automatically —
            for any CNC machine configuration.
          </p>
          <div class="auth-features">
            <div class="auth-feature">
              <div class="auth-feature-dot"></div>
              <span>Automatic feature recognition (holes, slots, contours)</span>
            </div>
            <div class="auth-feature">
              <div class="auth-feature-dot"></div>
              <span>Unlimited-axis machine configuration support</span>
            </div>
            <div class="auth-feature">
              <div class="auth-feature-dot"></div>
              <span>Fixture holder (U1, U2...) position optimization</span>
            </div>
            <div class="auth-feature">
              <div class="auth-feature-dot"></div>
              <span>Your personal STP library — always available</span>
            </div>
          </div>
        </div>

        <!-- Right form panel -->
        <div class="auth-right">
          <div class="auth-form-box slide-up">
            <h2>${isLogin ? 'Welcome back' : 'Create account'}</h2>
            <p class="auth-sub">${isLogin
              ? 'Sign in to access your part library.'
              : 'Start machining smarter today.'
            }</p>

            <div id="auth-error" class="auth-error hidden"></div>

            <form id="auth-form" novalidate>
              <div class="flex-col gap-4">
                ${!isLogin ? `
                  <div class="input-group">
                    <label>Display Name</label>
                    <input id="field-name" class="input" type="text" placeholder="Your name" required autocomplete="name" />
                  </div>
                ` : ''}
                <div class="input-group">
                  <label>Email</label>
                  <input id="field-email" class="input" type="email" placeholder="you@company.com" required autocomplete="email" />
                </div>
                <div class="input-group">
                  <label>Password</label>
                  <input id="field-password" class="input" type="password" placeholder="••••••••" required autocomplete="${isLogin ? 'current-password' : 'new-password'}" />
                </div>
                <button type="submit" class="btn btn-primary btn-lg w-full" id="auth-submit" style="margin-top:8px;">
                  <span id="auth-btn-text">${isLogin ? 'Sign In' : 'Create Account'}</span>
                </button>
              </div>
            </form>

            <div class="auth-switch">
              ${isLogin
                ? `Don't have an account? <a id="switch-mode">Sign up</a>`
                : `Already have an account? <a id="switch-mode">Sign in</a>`
              }
            </div>
          </div>
        </div>
      </div>
    `;

    // Toast container
    ensureToastContainer();

    // Switch mode
    document.getElementById('switch-mode').addEventListener('click', () => {
      isLogin = !isLogin;
      render();
    });

    // Form submit
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('auth-submit');
      const errEl = document.getElementById('auth-error');
      errEl.classList.add('hidden');
      errEl.textContent = '';
      btn.disabled = true;
      document.getElementById('auth-btn-text').textContent = isLogin ? 'Signing in…' : 'Creating…';

      try {
        const email = document.getElementById('field-email').value.trim();
        const password = document.getElementById('field-password').value;

        if (isLogin) {
          await api.login(email, password);
        } else {
          const displayName = document.getElementById('field-name').value.trim();
          if (!displayName) { showError('Please enter your name.'); return; }
          await api.register(email, password, displayName);
        }

        location.hash = '#/library';
      } catch (err) {
        showError(err.message || 'Authentication failed. Please try again.');
      } finally {
        btn.disabled = false;
        document.getElementById('auth-btn-text').textContent = isLogin ? 'Sign In' : 'Create Account';
      }
    });

    function showError(msg) {
      const errEl = document.getElementById('auth-error');
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    }
  }

  render();
}

function ensureToastContainer() {
  if (!document.getElementById('toast-container')) {
    const el = document.createElement('div');
    el.id = 'toast-container';
    document.body.appendChild(el);
  }
}
