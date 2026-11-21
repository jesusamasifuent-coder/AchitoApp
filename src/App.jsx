import './App.css'
import { useState, useEffect, useRef, useCallback } from 'react'
import { getStatus } from './services/esp32'

const THRESHOLD = 1500
const MAX_READING = 4095
const VERSION = '1.1'

const MENU = ['Inicio', 'Monitoreo', 'Eventos', 'Funcionamiento', 'Educación ambiental', 'Ajustes']

const SUBTITLES = {
  Inicio: 'Estado del contenedor en tiempo real',
  Monitoreo: 'Lecturas del sensor y posición de las compuertas',
  Eventos: 'Detecciones y cambios de conexión registrados',
  Funcionamiento: 'La secuencia que sigue el contenedor al detectar un residuo',
  'Educación ambiental': 'Qué son los residuos orgánicos y por qué aprovecharlos',
  Ajustes: 'Apariencia, frecuencia de lectura y datos guardados'
}

const EVENT_META = {
  detection: { label: 'Residuo detectado', tone: 'warn' },
  online: { label: 'ESP32 conectado', tone: 'ok' },
  offline: { label: 'Conexión perdida', tone: 'error' }
}

/* ---------- Utilidades ---------- */
const load = (key, fallback) => {
  try {
    const raw = localStorage.getItem(`achitoapp:${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

const save = (key, value) => {
  try {
    localStorage.setItem(`achitoapp:${key}`, JSON.stringify(value))
  } catch {
    /* almacenamiento no disponible */
  }
}

const isToday = iso => new Date(iso).toDateString() === new Date().toDateString()
const formatTime = iso => new Date(iso).toLocaleTimeString()
const formatDateTime = iso =>
  new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' })

function downloadCsv(filename, rows) {
  const csv = rows
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/* ---------- Iconos ---------- */
const ICONS = {
  Inicio: <path d="M3 11l9-8 9 8M5 10v10h14V10" />,
  Monitoreo: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  Eventos: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  Funcionamiento: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </>
  ),
  'Educación ambiental': <path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19c2-5 5-8 9-10" />,
  Ajustes: (
    <>
      <path d="M4 7h9M17 7h3M4 12h16M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </>
  ),
  moon: <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="M7 4l13 8-13 8z" />,
  download: <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
}

function Icon({ name }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}

/* ---------- Componentes ---------- */
function Bin({ servo1, servo2 }) {
  const levels = [
    { name: 'Nivel 1', angle: servo1 },
    { name: 'Nivel 2', angle: servo2 }
  ]

  return (
    <div className="bin" role="img" aria-label="Estado de las compuertas del contenedor">
      {levels.map(level => (
        <div className="bin-level" key={level.name}>
          <div className="bin-chamber">
            <span
              className={`bin-gate ${level.angle === 90 ? 'open' : ''}`}
              style={{ transform: `rotate(${-level.angle}deg)` }}
            />
          </div>
          <div className="bin-info">
            <span>{level.name}</span>
            <strong>{level.angle}°</strong>
            <em>{level.angle === 90 ? 'Abierta' : 'Cerrada'}</em>
          </div>
        </div>
      ))}
    </div>
  )
}

function Sparkline({ history }) {
  if (history.length < 2) {
    return <p className="empty">Esperando al menos dos lecturas del ESP32…</p>
  }

  const W = 400
  const H = 120
  const x = i => (i / (history.length - 1)) * W
  const y = v => H - (v / MAX_READING) * H
  const points = history
    .map((h, i) => `${x(i).toFixed(1)},${y(h.value).toFixed(1)}`)
    .join(' ')

  return (
    <>
      <svg
        className="spark"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Últimas lecturas del sensor LDR"
      >
        <line className="spark-threshold" x1="0" x2={W} y1={y(THRESHOLD)} y2={y(THRESHOLD)} />
        <polygon className="spark-area" points={`0,${H} ${points} ${W},${H}`} />
        <polyline className="spark-line" points={points} vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="chart-legend">
        Últimas {history.length} lecturas. La línea punteada marca el umbral de detección ({THRESHOLD}).
      </p>
    </>
  )
}

function EventList({ events, limit, emptyText }) {
  const items = limit ? events.slice(0, limit) : events

  if (items.length === 0) return <p className="empty">{emptyText}</p>

  return (
    <ul className="event-list">
      {items.map(event => {
        const meta = EVENT_META[event.type]
        return (
          <li key={event.id}>
            <span className={`event-dot ${meta.tone}`} aria-hidden="true" />
            <div className="event-body">
              <strong>{meta.label}</strong>
              {event.type === 'detection' && <span>Lectura LDR: {event.ldr}</span>}
            </div>
            <time dateTime={event.at}>{formatDateTime(event.at)}</time>
          </li>
        )
      })}
    </ul>
  )
}

function Segmented({ label, options, value, onChange }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(option => (
        <button
          key={option.value}
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- Aplicación ---------- */
function App() {
  const [notificationPermission, setNotificationPermission] = useState(
  typeof Notification !== 'undefined' ? Notification.permission : 'denied'
)

async function enableNotifications() {
  if (!('Notification' in window)) {
    alert('Tu navegador no admite notificaciones.')
    return
  }

  const permission = await Notification.requestPermission()
  setNotificationPermission(permission)

  if (permission === 'granted') {
    new Notification('AchitoApp', {
      body: '¡Notificaciones activadas correctamente!',
      icon: '/favicon.svg'
    })
  }
}
  const [connected, setConnected] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [paused, setPaused] = useState(false)
  const [ldr, setLdr] = useState(null)
  const [servo1, setServo1] = useState(0)
  const [servo2, setServo2] = useState(0)
  const [lastUpdate, setLastUpdate] = useState('--:--:--')
  const [history, setHistory] = useState([])
  const [events, setEvents] = useState(() => load('events', []))
  const [toast, setToast] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeSection, setActiveSection] = useState('Inicio')
  const [intervalMs, setIntervalMs] = useState(() => load('interval', 2000))
  const [theme, setTheme] = useState(() =>
    load('theme', window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  )

  const previous = useRef({ connected: null, detected: false })

  const detected = ldr !== null && ldr < THRESHOLD
  const percentage = ldr === null ? 0 : Math.min(100, Math.max(0, (ldr / MAX_READING) * 100))
  const thresholdPosition = (THRESHOLD / MAX_READING) * 100
  const detectionText = ldr === null ? 'Sin datos' : detected ? 'Detectado' : 'En reposo'

  const detectionsToday = events.filter(e => e.type === 'detection' && isToday(e.at))
  const lastDetection = detectionsToday[0]

  const addEvent = useCallback((type, ldrValue) => {
    const event = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      at: new Date().toISOString(),
      ldr: ldrValue
    }
    setEvents(prev => [event, ...prev].slice(0, 200))
  }, [])

  const notify = useCallback((text, tone) => {
  setToast({ text, tone, id: Date.now() })

  if (
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted'
  ) {
    new Notification('AchitoApp', {
      body: text,
      icon: '/favicon.svg'
    })
  }
}, [])
  /* Lectura periódica del ESP32 */
  useEffect(() => {
    if (paused) return undefined

    let active = true

    const updateStatus = async () => {
      const data = await getStatus()
      if (!active) return

      setLoaded(true)

      if (data) {
        const isDetected = data.ldr < THRESHOLD

        if (previous.current.connected === false) {
          addEvent('online')
          notify('ESP32 conectado de nuevo', 'ok')
        }
        if (isDetected && !previous.current.detected) {
          addEvent('detection', data.ldr)
          notify('Residuo detectado', 'warn')
        }
        previous.current = { connected: true, detected: isDetected }

        setConnected(true)
        setLdr(data.ldr)
        setServo1(data.servo1)
        setServo2(data.servo2)

        const currentTime = new Date().toLocaleTimeString()
        setLastUpdate(currentTime)
        setHistory(prev => [...prev, { value: data.ldr, time: currentTime }].slice(-20))
      } else {
        if (previous.current.connected === true) {
          addEvent('offline')
          notify('Se perdió la conexión con el ESP32', 'error')
        }
        previous.current = { connected: false, detected: false }

        setConnected(false)
        setLdr(null)
        setServo1(0)
        setServo2(0)
      }
    }

    updateStatus()
    const timer = setInterval(updateStatus, intervalMs)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [paused, intervalMs, addEvent, notify])

  /* Persistencia y efectos de interfaz */
  useEffect(() => save('events', events), [events])
  useEffect(() => save('interval', intervalMs), [intervalMs])
  useEffect(() => {
    save('theme', theme)
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    document.title = `AchitoApp · ${activeSection}`
  }, [activeSection])
  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  const clearEvents = () => {
    if (window.confirm('¿Borrar todo el registro de eventos? Esta acción no se puede deshacer.')) {
      setEvents([])
    }
  }

  const exportHistory = () =>
    downloadCsv('achitoapp-lecturas.csv', [
      ['Hora', 'Lectura LDR'],
      ...history.map(h => [h.time, h.value])
    ])

  const exportEvents = () =>
    downloadCsv('achitoapp-eventos.csv', [
      ['Fecha y hora', 'Evento', 'Detalle'],
      ...events.map(e => [
        formatDateTime(e.at),
        EVENT_META[e.type].label,
        e.type === 'detection' ? `LDR ${e.ldr}` : ''
      ])
    ])

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <a className="skip-link" href="#contenido">Saltar al contenido</a>

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">A</div>
          <div className="brand-text">
            <h1>AchitoApp</h1>
            <span>Gestión inteligente</span>
          </div>
        </div>

        <button
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? 'Expandir menú' : 'Contraer menú'}
          aria-expanded={!sidebarCollapsed}
        >
          {sidebarCollapsed ? '›' : '‹'}
        </button>

        <nav className="navigation" aria-label="Secciones">
          {MENU.map(name => (
            <button
              key={name}
              className={`nav-button ${activeSection === name ? 'active' : ''}`}
              onClick={() => setActiveSection(name)}
              aria-current={activeSection === name ? 'page' : undefined}
              title={name}
            >
              <Icon name={name} />
              <span className="nav-text">{name}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <span className={`connection-dot ${connected ? 'connected' : ''}`} />
          <span className="status-text">
            {connected ? 'ESP32 conectado' : 'ESP32 desconectado'}
          </span>
        </div>
      </aside>

      <main className="main-content" id="contenido" tabIndex={-1}>

        <header className="page-header">
          <div>
            <h2>{activeSection}</h2>
            <p>{SUBTITLES[activeSection]}</p>
          </div>

          <div className="header-actions">
            <button
              className="icon-button"
              onClick={() => setPaused(!paused)}
              aria-pressed={paused}
              title={paused ? 'Reanudar lecturas' : 'Pausar lecturas'}
            >
              <Icon name={paused ? 'play' : 'pause'} />
              <span>{paused ? 'Reanudar' : 'Pausar'}</span>
            </button>

            <button
              className="icon-button square"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
              title={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>

            <div className={`connection-badge ${paused ? 'paused' : connected ? 'online' : 'offline'}`}>
              <span className={`connection-dot ${connected && !paused ? 'connected' : ''}`} />
              {paused ? 'En pausa' : connected ? 'En línea' : 'Desconectado'}
            </div>
          </div>
        </header>

        {loaded && !connected && !paused && (
          <div className="banner error" role="alert">
            <strong>Sin conexión con el ESP32.</strong>
            <span>
              Verifica que esté encendido y conectado a la misma red Wi-Fi. La aplicación
              reintenta automáticamente cada {intervalMs / 1000} s.
            </span>
          </div>
        )}

        {paused && (
          <div className="banner info">
            <strong>Lecturas en pausa.</strong>
            <span>Los datos mostrados no se están actualizando. Pulsa Reanudar para continuar.</span>
          </div>
        )}

        {activeSection === 'Inicio' && (
          <>
            <section className="hero">
              <div className="hero-text">
                <h3>Bienvenido al sistema de monitoreo</h3>
                <p>
                  Supervisa las lecturas del sensor, observa el estado de las
                  compuertas y conoce cómo funciona nuestro sistema inteligente
                  de gestión de residuos orgánicos.
                </p>
                <button onClick={() => setActiveSection('Monitoreo')}>Ir al monitoreo</button>
              </div>
              <Bin servo1={servo1} servo2={servo2} />
            </section>

            <dl className="stats">
              <div>
                <dt>Conexión ESP32</dt>
                <dd className={connected ? 'online' : 'offline'}>
                  {connected ? 'Conectado' : 'Desconectado'}
                </dd>
                <small>{paused ? 'Lecturas en pausa' : `Actualiza cada ${intervalMs / 1000} s`}</small>
              </div>
              <div>
                <dt>Lectura LDR</dt>
                <dd className={detected ? 'alert' : ''}>{ldr ?? '--'}</dd>
                <small>{detectionText}</small>
              </div>
              <div>
                <dt>Detecciones hoy</dt>
                <dd>{detectionsToday.length}</dd>
                <small>
                  {lastDetection ? `Última a las ${formatTime(lastDetection.at)}` : 'Aún sin detecciones'}
                </small>
              </div>
              <div>
                <dt>Última actualización</dt>
                <dd>{lastUpdate}</dd>
                <small>Hora de la última lectura</small>
              </div>
            </dl>

            <section className="panel recent">
              <div className="panel-head">
                <h3>Actividad reciente</h3>
                <button className="link-button" onClick={() => setActiveSection('Eventos')}>
                  Ver registro completo
                </button>
              </div>
              <EventList
                events={events}
                limit={4}
                emptyText="Todavía no hay eventos. Aparecerán aquí cuando el contenedor detecte un residuo."
              />
            </section>
          </>
        )}

        {activeSection === 'Monitoreo' && (
          <div className="monitor-layout">
            <div className="monitor-column">
              <section className="panel">
                <h3>Sensor de luz (LDR)</h3>

                <div className="sensor-reading">
                  <span className="sensor-value">{ldr ?? '--'}</span>
                  <span className={`pill ${ldr === null ? '' : detected ? 'warn' : 'ok'}`}>
                    {ldr === null
                      ? 'Esperando lectura'
                      : detected
                        ? 'Umbral de detección alcanzado'
                        : 'Sin detección'}
                  </span>
                </div>

                <div className="meter">
                  <div
                    className={`meter-fill ${detected ? 'detected' : ''}`}
                    style={{ width: `${percentage}%` }}
                  />
                  <span className="meter-mark" style={{ left: `${thresholdPosition}%` }} />
                </div>
                <div className="meter-scale">
                  <span>0</span>
                  <span style={{ left: `${thresholdPosition}%` }} className="meter-mark-label">
                    Umbral {THRESHOLD}
                  </span>
                  <span>{MAX_READING}</span>
                </div>

                <p className="note">
                  El LDR mide intensidad de luz. No identifica por sí solo
                  el tipo de residuo.
                </p>
              </section>

              <section className="panel">
                <h3>Evolución de la lectura</h3>
                <Sparkline history={history} />
              </section>
            </div>

            <div className="monitor-column">
              <section className="panel">
                <h3>Control de compuertas</h3>
                <Bin servo1={servo1} servo2={servo2} />
              </section>

              <section className="panel">
                <div className="panel-head">
                  <h3>Historial del sensor LDR</h3>
                  <button className="link-button" onClick={exportHistory} disabled={history.length === 0}>
                    <Icon name="download" /> Exportar CSV
                  </button>
                </div>

                {history.length === 0 ? (
                  <p className="empty">Esperando datos del ESP32…</p>
                ) : (
                  <ul className="history-list">
                    {[...history].reverse().map((item, index) => (
                      <li key={index}>
                        <span>{item.time}</span>
                        <strong>{item.value}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        )}

        {activeSection === 'Eventos' && (
          <section className="panel">
            <div className="panel-head">
              <h3>
                Registro de eventos <span className="count">{events.length}</span>
              </h3>
              <button className="link-button" onClick={exportEvents} disabled={events.length === 0}>
                <Icon name="download" /> Exportar CSV
              </button>
            </div>
            <EventList
              events={events}
              emptyText="El registro está vacío. Se guardan las detecciones y los cambios de conexión, y se conservan al cerrar la página."
            />
          </section>
        )}

        {activeSection === 'Funcionamiento' && (
          <section className="panel">
            <h3>¿Cómo funciona AchitoApp?</h3>

            <p className="section-intro">
              El sistema utiliza un sensor de luz y dos servomotores
              para ejecutar una secuencia automática de compuertas.
            </p>

            <ol className="steps">
              <li>
                <span className="step-number">1</span>
                <div>
                  <h4>Detección</h4>
                  <p>
                    El sensor LDR registra la intensidad de luz.
                    Si la lectura es inferior a {THRESHOLD}, se activa el proceso.
                  </p>
                </div>
              </li>
              <li>
                <span className="step-number">2</span>
                <div>
                  <h4>Apertura del nivel 1</h4>
                  <p>El primer servomotor gira 90° y abre la primera compuerta.</p>
                </div>
              </li>
              <li>
                <span className="step-number">3</span>
                <div>
                  <h4>Transferencia al nivel 2</h4>
                  <p>El segundo servomotor gira 90° y activa la segunda compuerta.</p>
                </div>
              </li>
              <li>
                <span className="step-number">4</span>
                <div>
                  <h4>Cierre automático</h4>
                  <p>Las compuertas regresan a 0° y el sistema vuelve al reposo.</p>
                </div>
              </li>
            </ol>

            <div className="info-note">
              <strong>Importante</strong>
              <p>
                El sensor LDR detecta cambios en la luz, no reconoce
                directamente si un residuo es orgánico. Esa clasificación
                depende del diseño físico del contenedor.
              </p>
            </div>
          </section>
        )}

        {activeSection === 'Educación ambiental' && (
          <>
            <p className="section-intro wide">
              Aprende sobre los residuos orgánicos y la importancia
              de aprovecharlos responsablemente.
            </p>

            <div className="education-grid">
              <article className="panel">
                <h3>¿Qué son los residuos orgánicos?</h3>
                <p>
                  Son desechos biodegradables provenientes de seres vivos,
                  como restos de frutas, verduras y otros alimentos.
                </p>
              </article>

              <article className="panel">
                <h3>Ejemplos de residuos</h3>
                <ul className="leaf-list">
                  <li>Cáscaras de frutas</li>
                  <li>Restos de verduras</li>
                  <li>Cáscaras de huevo</li>
                  <li>Restos de café</li>
                  <li>Hojas secas</li>
                </ul>
              </article>

              <article className="panel">
                <h3>¿Qué es el compostaje?</h3>
                <p>
                  Es un proceso natural mediante el cual los residuos
                  orgánicos se transforman en abono que puede aprovecharse
                  para mejorar el suelo.
                </p>
              </article>

              <article className="panel">
                <h3>Impacto ambiental</h3>
                <p>
                  Separar los residuos orgánicos permite aprovechar
                  materiales biodegradables y reducir la cantidad de
                  desechos enviados a los vertederos.
                </p>
              </article>
            </div>
          </>
        )}

        {activeSection === 'Ajustes' && (
           
          <div className="settings">
            <section className="panel">
  <div className="setting">
    <div>
      <h3>Notificaciones del sistema</h3>
      <p>
        Recibe alertas de AchitoApp cuando ocurran detecciones
        o cambios en la conexión del ESP32.
      </p>
      <small>
        Estado: {
          notificationPermission === 'granted'
            ? 'Activadas'
            : notificationPermission === 'denied'
              ? 'Bloqueadas en Chrome'
              : 'Pendientes de autorización'
        }
      </small>
    </div>

    <button
      className="icon-button"
      onClick={enableNotifications}
      disabled={notificationPermission === 'granted'}
    >
      {notificationPermission === 'granted'
        ? 'Activadas'
        : 'Activar notificaciones'}
    </button>
  </div>
</section>
            <section className="panel">
              <div className="setting">
                <div>
                  <h3>Apariencia</h3>
                  <p>Elige el tema de la interfaz. Se recuerda en este navegador.</p>
                </div>
                <Segmented
                  label="Tema"
                  value={theme}
                  onChange={setTheme}
                  options={[
                    { value: 'light', label: 'Claro' },
                    { value: 'dark', label: 'Oscuro' }
                  ]}
                />
              </div>

              <div className="setting">
                <div>
                  <h3>Frecuencia de lectura</h3>
                  <p>Cada cuánto se consulta al ESP32. Un intervalo corto da datos más frescos.</p>
                </div>
                <Segmented
                  label="Frecuencia de lectura"
                  value={intervalMs}
                  onChange={setIntervalMs}
                  options={[
                    { value: 1000, label: '1 s' },
                    { value: 2000, label: '2 s' },
                    { value: 5000, label: '5 s' }
                  ]}
                />
              </div>

              <div className="setting">
                <div>
                  <h3>Registro de eventos</h3>
                  <p>{events.length} eventos guardados en este navegador.</p>
                </div>
                <button className="danger-button" onClick={clearEvents} disabled={events.length === 0}>
                  Borrar registro
                </button>
              </div>
            </section>

            <section className="panel">
              <h3>Acerca de</h3>
              <p>
                AchitoApp {VERSION}. Monitorea el prototipo de gestión de residuos orgánicos
                mediante solicitudes HTTP al ESP32. El umbral de detección ({THRESHOLD}) se define en
                el firmware del ESP32; esta aplicación solo lo muestra.
              </p>
            </section>
          </div>
        )}

        <footer className="main-footer">
          AchitoApp © 2026 · Gestión inteligente de residuos orgánicos · v{VERSION}
        </footer>
      </main>

      <div className="toast-region" aria-live="polite">
        {toast && (
          <div className={`toast ${toast.tone}`} key={toast.id}>
            {toast.text}
          </div>
        )}
      </div>
    </div>
  )
}

export default App