const LOGO = `${import.meta.env.BASE_URL}Vadana.svg`
const asset = (filename) => `${import.meta.env.BASE_URL}${encodeURI(filename)}`

const REPO = 'https://github.com/Lohit-Behera/vadana'
const DOCS = `${REPO}/blob/main/README.md`
const BUILD = `${REPO}/blob/main/docs/build.md`
const RELEASES = `${REPO}/releases`
const DOWNLOAD =
  'https://github.com/Lohit-Behera/vadana/releases/download/v0.2.5/Vadana_0.2.5_x64-setup.exe'

const features = [
  {
    title: 'Local speech recognition',
    description:
      'On-device Whisper transcription with Silero VAD — your voice stays on your machine.',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
      />
    ),
  },
  {
    title: 'Flexible LLM routing',
    description:
      'LiteLLM connects to LM Studio, Ollama, OpenAI, Anthropic, Groq, and more from one settings panel.',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
      />
    ),
  },
  {
    title: 'Natural text-to-speech',
    description:
      'Supertonic, Piper, or system TTS — pick quality and language without sending audio to the cloud.',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"
      />
    ),
  },
  {
    title: 'Desktop-native & private',
    description:
      'Tauri shell, SQLite chat history, OS keychain for API keys, and a localhost-only WebSocket sidecar.',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    ),
  },
]

const screenshots = [
  {
    title: 'Home & sessions',
    description: 'Sidebar history, model status, and one-click voice start.',
    src: asset('vadana _1.png'),
  },
  {
    title: 'Voice & chat',
    description: 'Live transcript with typed or spoken messages in session.',
    src: asset('vadana_3.png'),
  },
  {
    title: 'Sphere visualizer',
    description: 'Ambient voice activity view while the assistant listens.',
    src: asset('vadana_4.png'),
  },
  {
    title: 'LLM settings',
    description: 'Switch providers, fetch models, and tune context limits.',
    src: asset('vadana_2.png'),
  },
  {
    title: 'Knowledge base',
    description: 'Import PDFs, index folders, and ground replies on your files.',
    src: asset('vadana_5.png'),
  },
  {
    title: 'Voice settings',
    description: 'Whisper model size, mic volume, and VAD sensitivity.',
    src: asset('vadana_6.png'),
  },
]

const stack = ['Tauri 2', 'React', 'Whisper', 'LiteLLM', 'Silero VAD', 'Supertonic', 'SQLite']

function Logo({ className = 'size-9' }) {
  return (
    <img src={LOGO} alt="" className={`object-contain ${className}`} aria-hidden />
  )
}

function Icon({ children, className = '' }) {
  return (
    <svg
      className={`size-6 ${className}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden
    >
      {children}
    </svg>
  )
}

function NavLink({ href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-sm text-slate-400 transition-colors hover:text-brand-300"
    >
      {children}
    </a>
  )
}

function App() {
  return (
    <div className="relative overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-60" aria-hidden />

      <header className="sticky top-0 z-50 border-b border-white/5 bg-ink-950/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <a href="#" className="group flex items-center gap-2.5">
            <Logo className="size-10 transition group-hover:scale-105" />
            <span className="font-display text-lg font-semibold tracking-tight text-white">
              Vadana
            </span>
          </a>

          <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
            <a href="#features" className="text-sm text-slate-400 transition-colors hover:text-white">
              Features
            </a>
            <a
              href="#screenshots"
              className="text-sm text-slate-400 transition-colors hover:text-white"
            >
              Screenshots
            </a>
            <NavLink href={DOCS}>Docs</NavLink>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white sm:inline-flex"
            >
              GitHub
            </a>
            <a
              href={DOWNLOAD}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-ink-950 shadow-lg shadow-brand-500/25 transition hover:bg-brand-400"
            >
              Download
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="relative mx-auto max-w-6xl px-5 pb-20 pt-16 sm:px-8 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <Logo className="mx-auto mb-8 size-20 sm:size-24" />
            <p className="mb-5 inline-flex flex-wrap items-center justify-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/15 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-amber-200">
                <span className="size-1.5 rounded-full bg-amber-400 shadow-[0_0_8px] shadow-amber-400" />
                Stable release
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-400/20 bg-brand-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-brand-300">
                Open source · Local-first
              </span>
            </p>
            <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-6xl">
              Speak naturally with a{' '}
              <span className="text-gradient">voice assistant</span> that never leaves your desk
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-400">
              Vadana is a desktop assistant powered by Whisper, LiteLLM, and flexible TTS — built
              with Tauri and a Python sidecar so conversations stay on your machine.
            </p>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <a
                href={DOWNLOAD}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-ink-950 shadow-lg shadow-brand-500/30 transition hover:-translate-y-0.5 hover:bg-brand-400"
              >
                <Icon className="size-5">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12M12 16.5V3"
                  />
                </Icon>
                Download for Windows
              </a>
              <a
                href={REPO}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white backdrop-blur transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10"
              >
                View on GitHub
              </a>
            </div>

            <p className="mt-4 text-sm text-slate-500">
              MIT licensed · Also see{' '}
              <a href={BUILD} target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">
                build guide
              </a>{' '}
              for macOS & Linux
            </p>
          </div>

          <div className="relative mx-auto mt-16 max-w-4xl">
            <div
              className="pointer-events-none absolute -inset-4 rounded-3xl bg-brand-500/20 blur-3xl"
              aria-hidden
            />
            <div className="glass relative overflow-hidden rounded-2xl p-1.5 shadow-2xl shadow-black/40 ring-1 ring-white/10">
              <img
                src={asset('vadana _1.png')}
                alt="Vadana home screen with chat sidebar and Start button"
                className="w-full rounded-xl object-cover"
              />
            </div>
          </div>
        </section>

        <section id="features" className="border-t border-white/5 bg-ink-900/50 py-20">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Everything you need for local voice AI
              </h2>
              <p className="mt-4 text-slate-400">
                From microphone to model reply to spoken response — one cohesive desktop workflow.
              </p>
            </div>

            <ul className="mt-14 grid gap-5 sm:grid-cols-2">
              {features.map((feature) => (
                <li
                  key={feature.title}
                  className="glass group rounded-2xl p-6 transition hover:border-brand-400/25 hover:bg-white/[0.07]"
                >
                  <span className="mb-4 inline-flex rounded-xl bg-brand-500/15 p-3 text-brand-400 ring-1 ring-brand-400/20 transition group-hover:bg-brand-500/20">
                    <Icon>{feature.icon}</Icon>
                  </span>
                  <h3 className="text-lg font-semibold text-white">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{feature.description}</p>
                </li>
              ))}
            </ul>

            <div className="mt-12 flex flex-wrap items-center justify-center gap-2">
              {stack.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/8 bg-white/5 px-3 py-1 text-xs font-medium text-slate-400"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section id="screenshots" className="py-20">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  See it in action
                </h2>
                <p className="mt-3 max-w-xl text-slate-400">
                  Chat, voice visualization, provider settings, knowledge import, and more — all
                  in one desktop app.
                </p>
              </div>
              <a
                href={RELEASES}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-brand-400 hover:text-brand-300"
              >
                All releases →
              </a>
            </div>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {screenshots.map((shot) => (
                <article
                  key={shot.title}
                  className="glass group overflow-hidden rounded-2xl transition hover:border-brand-400/25 hover:bg-white/[0.07]"
                >
                  <div className="overflow-hidden border-b border-white/10 bg-ink-900/50">
                    <img
                      src={shot.src}
                      alt={shot.title}
                      className="aspect-video w-full object-cover object-top transition duration-300 group-hover:scale-[1.02]"
                      loading="lazy"
                    />
                  </div>
                  <div className="px-5 py-4">
                    <h3 className="font-medium text-white">{shot.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{shot.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-white/5 py-20">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <div className="glass overflow-hidden rounded-3xl p-8 sm:p-12">
              <div className="flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-xl">
                  <h2 className="font-display text-2xl font-semibold text-white sm:text-3xl">
                    Ready to try Vadana?
                  </h2>
                  <p className="mt-3 text-slate-400">
                    Clone the repo, run <code className="rounded bg-black/30 px-1.5 py-0.5 text-brand-300">pnpm tauri dev</code>, or grab the latest Windows installer from GitHub Releases.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <a
                    href={DOCS}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    Read the docs
                  </a>
                  <a
                    href={REPO}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brand-400"
                  >
                    Star on GitHub
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 text-center text-sm text-slate-500 sm:flex-row sm:px-8 sm:text-left">
          <div className="flex items-center gap-2.5">
            <Logo className="size-8" />
            <p>
              <span className="font-display font-medium text-slate-300">Vadana</span> — Sanskrit for
              speech. MIT License.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-6">
            <NavLink href={REPO}>Source</NavLink>
            <NavLink href={DOCS}>Documentation</NavLink>
            <NavLink href={BUILD}>Build</NavLink>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default App
