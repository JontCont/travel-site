import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string
}

function SvgBase({ size = 18, className, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ? `ui-icon ${className}` : 'ui-icon'}
      {...props}
    >
      {children}
    </svg>
  )
}

export function BrandSparkIcon({ size = 18, ...props }: IconProps) {
  return (
    <SvgBase size={size} strokeWidth={2.1} {...props}>
      <path d="M12 3.5v17" />
      <path d="M3.5 12h17" />
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </SvgBase>
  )
}

export function MenuIcon({ size = 18, ...props }: IconProps) {
  return (
    <SvgBase size={size} strokeWidth={2} {...props}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </SvgBase>
  )
}

export function CloseIcon({ size = 16, ...props }: IconProps) {
  return (
    <SvgBase size={size} strokeWidth={2} {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </SvgBase>
  )
}

export function ChevronLeftIcon({ size = 16, ...props }: IconProps) {
  return (
    <SvgBase size={size} strokeWidth={2} {...props}>
      <path d="m15 18-6-6 6-6" />
    </SvgBase>
  )
}

export function ArrowUpRightIcon({ size = 15, ...props }: IconProps) {
  return (
    <SvgBase size={size} strokeWidth={2} {...props}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </SvgBase>
  )
}

export function ArrowRightIcon({ size = 16, ...props }: IconProps) {
  return (
    <SvgBase size={size} strokeWidth={2} {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </SvgBase>
  )
}

export function PlusIcon({ size = 15, ...props }: IconProps) {
  return (
    <SvgBase size={size} strokeWidth={2.1} {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </SvgBase>
  )
}

export function ClockIcon({ size = 17, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </SvgBase>
  )
}

export function CalendarGridIcon({ size = 17, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
      <path d="M8 3v3" />
      <path d="M16 3v3" />
      <path d="M3.5 9.5h17" />
      <path d="M8.5 14h2" />
      <path d="M13.5 14h2" />
      <path d="M8.5 17h2" />
    </SvgBase>
  )
}

export function MapPinIcon({ size = 17, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.4" />
    </SvgBase>
  )
}

export function PlaneIcon({ size = 17, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z" />
    </SvgBase>
  )
}

export function HotelIcon({ size = 17, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9v11h13V9" />
      <path d="M9.5 20v-5.5h5V20" />
    </SvgBase>
  )
}

export function UsersIcon({ size = 17, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <path d="M16 20v-1.8a3.8 3.8 0 0 0-3.8-3.8H6.8A3.8 3.8 0 0 0 3 18.2V20" />
      <circle cx="9.5" cy="7.5" r="3.3" />
      <path d="M21 20v-1.6a3.5 3.5 0 0 0-2.6-3.4" />
      <path d="M15.2 4.3a3.3 3.3 0 0 1 0 6.4" />
    </SvgBase>
  )
}

export function CodeBracesIcon({ size = 17, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <path d="M8.5 4.5 6.8 6.2a1.8 1.8 0 0 0-.5 1.3v2.2c0 .7-.4 1.4-1.1 1.7L4 12l1.2.6c.7.3 1.1 1 1.1 1.7v2.2c0 .5.2.9.5 1.3l1.7 1.7" />
      <path d="m15.5 4.5 1.7 1.7c.3.4.5.8.5 1.3v2.2c0 .7.4 1.4 1.1 1.7L20 12l-1.2.6c-.7.3-1.1 1-1.1 1.7v2.2c0 .5-.2.9-.5 1.3l-1.7 1.7" />
    </SvgBase>
  )
}

export function BookOpenIcon({ size = 17, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <path d="M2.5 5.5h6a3.5 3.5 0 0 1 3.5 3.5v11a2.8 2.8 0 0 0-2.8-2.8H2.5V5.5Z" />
      <path d="M21.5 5.5h-6A3.5 3.5 0 0 0 12 9v11a2.8 2.8 0 0 1 2.8-2.8h6.7V5.5Z" />
    </SvgBase>
  )
}

export function KeyShieldIcon({ size = 17, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <path d="M12 3 4.5 6.2v5.3c0 5 3.2 8.7 7.5 10 4.3-1.3 7.5-5 7.5-10V6.2L12 3Z" />
      <circle cx="12" cy="11" r="1.8" />
      <path d="M12 12.8v2.8" />
    </SvgBase>
  )
}

export function SparkleIcon({ size = 18, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <path d="M12 3.5c.8 4.4 4.1 7.7 8.5 8.5-4.4.8-7.7 4.1-8.5 8.5-.8-4.4-4.1-7.7-8.5-8.5 4.4-.8 7.7-4.1 8.5-8.5Z" />
    </SvgBase>
  )
}

export function CrosshairIcon({ size = 15, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 2.5v3" />
      <path d="M12 18.5v3" />
      <path d="M2.5 12h3" />
      <path d="M18.5 12h3" />
      <circle cx="12" cy="12" r="1.8" />
    </SvgBase>
  )
}

export function SearchIcon({ size = 15, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </SvgBase>
  )
}

export function CheckIcon({ size = 14, ...props }: IconProps) {
  return (
    <SvgBase size={size} strokeWidth={2.2} {...props}>
      <path d="m5 12.5 4.2 4.2L19 7" />
    </SvgBase>
  )
}

export function BoltIcon({ size = 14, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <path d="M13 2 4.5 13.5H12L11 22l8.5-11.5H12L13 2Z" />
    </SvgBase>
  )
}

export function RotateCcwIcon({ size = 14, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <path d="M3.5 4.5v5h5" />
      <path d="M4.1 14a8 8 0 1 0 1.7-7.7L3.5 9.5" />
    </SvgBase>
  )
}

export function SaveIcon({ size = 14, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </SvgBase>
  )
}

export function CompassRocketIcon({ size = 18, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <circle cx="12" cy="12" r="9" />
      <polygon points="16.2 7.8 14.1 14.1 7.8 16.2 9.9 9.9 16.2 7.8" />
    </SvgBase>
  )
}

export function HelpCircleIcon({ size = 18, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.3 9.2a2.8 2.8 0 0 1 5.3 1c0 1.9-2.6 2.3-2.6 3.8" />
      <circle cx="12" cy="17.2" r="0.6" fill="currentColor" />
    </SvgBase>
  )
}

export function InfoCircleIcon({ size = 17, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.6" fill="currentColor" />
    </SvgBase>
  )
}

export function AlertTriangleIcon({ size = 17, ...props }: IconProps) {
  return (
    <SvgBase size={size} {...props}>
      <path d="M10.3 3.9 2.3 18a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4.5" />
      <circle cx="12" cy="16.8" r="0.6" fill="currentColor" />
    </SvgBase>
  )
}
