/** Non-draggable "Your location" row at top of StopList when GPS is granted. */
export default function GpsOriginItem() {
  return (
    <div
      className="flex items-center gap-2 py-1.5 px-2 rounded"
      style={{
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {/* Spacer matching drag handle width */}
      <span className="w-[14px]" />

      {/* ATAK chevron icon */}
      <span className="w-5 h-5 flex items-center justify-center shrink-0">
        <svg width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M8 1 L14 13 L8 10 L2 13 Z"
            fill="var(--accent)"
            stroke="var(--pin-stroke)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      {/* Label */}
      <span className="flex-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
        Your location
      </span>
    </div>
  )
}
