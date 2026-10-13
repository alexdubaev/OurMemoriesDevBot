const readOnlyNoticeId = 'diagnostic-read-only-notice'

export function DiagnosticNavigation({ role }: { role: 'full' | 'viewer' }) {
  return <nav aria-label="Основная навигация" className="diagnostic-navigation">
    <div className="diagnostic-navigation-items">
      <a aria-current="page" className="diagnostic-navigation-item diagnostic-navigation-feed" href="#diagnostic-feed">
        <img alt="" height="24" src="/assets/icons/home-active@2x.webp" width="24" />
        <span>Лента</span>
      </a>
      {role === 'viewer' ? <div aria-describedby={readOnlyNoticeId} className="diagnostic-navigation-item diagnostic-navigation-viewer" data-role="viewer">
        <span>Просмотр</span>
      </div> : <button aria-describedby={readOnlyNoticeId} className="diagnostic-navigation-item diagnostic-navigation-add" disabled type="button">
        <span className="diagnostic-navigation-add-circle"><img alt="" height="24" src="/assets/icons/plus-default@2x.webp" width="24" /></span>
        <span>Добавить</span>
      </button>}
      <button aria-describedby={readOnlyNoticeId} className="diagnostic-navigation-item" disabled type="button">
        <img alt="" height="24" src="/assets/icons/family-default@2x.webp" width="24" />
        <span>Семья</span>
      </button>
    </div>
  </nav>
}
