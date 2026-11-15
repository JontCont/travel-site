import { useState, type FormEvent } from 'react'
import { defineTrip, type Trip } from '@travel/shared'

const COMMON_TIMEZONES = [
  'Asia/Tokyo',
  'Asia/Taipei',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Paris',
  'America/Los_Angeles',
  'America/New_York',
  'Australia/Sydney',
]

export interface CreateTripModalProps {
  defaultTimeZone?: string
  onClose: () => void
  onCreate: (trip: Trip) => void
}

export function CreateTripModal({ defaultTimeZone = 'Asia/Tokyo', onClose, onCreate }: CreateTripModalProps) {
  const [title, setTitle] = useState('')
  const [destination, setDestination] = useState('')
  const [country, setCountry] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [timeZone, setTimeZone] = useState(defaultTimeZone)
  const [description, setDescription] = useState('')
  const [hotelName, setHotelName] = useState('')
  const [hotelAddress, setHotelAddress] = useState('')
  const [error, setError] = useState('')

  function handleStartDateChange(value: string) {
    setStartDate(value)
    if (!endDate || (value && endDate < value)) {
      setEndDate(value)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (!title.trim()) {
      setError('請輸入旅程名稱。')
      return
    }
    if (!destination.trim()) {
      setError('請輸入目的地。')
      return
    }
    if (!startDate || !endDate) {
      setError('請選擇開始日期與結束日期。')
      return
    }
    if (endDate < startDate) {
      setError('結束日期不能早於開始日期。')
      return
    }

    try {
      const trip = defineTrip({
        id: crypto.randomUUID(),
        title,
        destination,
        country,
        startDate,
        endDate,
        timeZone,
        description: description.trim(),
        hotelName: hotelName.trim(),
        hotelAddress: hotelAddress.trim(),
      })
      onCreate(trip)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : '建立旅程失敗，請檢查欄位格式。')
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-trip-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="overline">NEW JOURNEY</span>
            <h2 id="create-trip-title">新增旅程</h2>
          </div>
          <button type="button" className="modal-close" aria-label="關閉" onClick={onClose}>✕</button>
        </div>
        <p className="modal-subtitle">可建立未來的出國計畫，或補登過去已結束的歷史行程（會自動歸類至「封存」與「旅程時間軸」）。</p>
        <form className="modal-form" onSubmit={handleSubmit}>
          <label>
            旅程名稱 *
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：2024 東京賞櫻"
              autoFocus
            />
          </label>
          <div className="form-row">
            <label>
              目的地 *
              <input
                required
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                placeholder="例如：東京"
              />
            </label>
            <label>
              國家 / 地區
              <input
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                placeholder="例如：日本、中國大陸"
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              開始日期 *
              <input
                type="date"
                required
                value={startDate}
                onChange={(event) => handleStartDateChange(event.target.value)}
              />
            </label>
            <label>
              結束日期 *
              <input
                type="date"
                required
                min={startDate || undefined}
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>
          </div>
          <label>
            當地時區 (IANA) *
            <input
              required
              list="common-timezones"
              value={timeZone}
              onChange={(event) => setTimeZone(event.target.value)}
              placeholder="例如：Asia/Tokyo"
            />
            <datalist id="common-timezones">
              {COMMON_TIMEZONES.map((tz) => <option key={tz} value={tz} />)}
            </datalist>
          </label>
          <label>
            旅程簡介（選填）
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="簡短記錄這趟旅程的主題或備註"
            />
          </label>
          <div className="form-row">
            <label>
              住宿名稱（選填）
              <input
                value={hotelName}
                onChange={(event) => setHotelName(event.target.value)}
                placeholder="例如：新宿格拉斯麗飯店"
              />
            </label>
            <label>
              住宿地址（選填）
              <input
                value={hotelAddress}
                onChange={(event) => setHotelAddress(event.target.value)}
                placeholder="確認後再填寫"
              />
            </label>
          </div>
          {error && <p className="notice danger" role="alert">{error}</p>}
          <div className="form-actions modal-actions">
            <button type="submit">建立旅程</button>
            <button type="button" className="plain" onClick={onClose}>取消</button>
          </div>
        </form>
      </div>
    </div>
  )
}
