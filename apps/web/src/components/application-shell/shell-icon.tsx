type ShellIconName = 'addCatch' | 'bait' | 'bases' | 'fish' | 'home' | 'search';

type ShellIconProps = {
  name: ShellIconName;
};

export function ShellIcon({ name }: ShellIconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      {name === 'home' ? (
        <>
          <path d="M3.75 10.4 12 3.75l8.25 6.65" />
          <path d="M5.75 9.5v10.25h12.5V9.5M9.25 19.75v-6h5.5v6" />
        </>
      ) : null}
      {name === 'bases' ? (
        <>
          <path d="m3.75 6.25 5-2 6.5 2.5 5-2v13l-5 2-6.5-2.5-5 2z" />
          <path d="M8.75 4.25v13M15.25 6.75v13" />
        </>
      ) : null}
      {name === 'fish' ? (
        <>
          <path d="M4.25 12c2.2-3.45 5.13-5.25 8.75-5.25 2.72 0 4.87 1.1 6.75 3.25l-3 2 3 2c-1.88 2.15-4.03 3.25-6.75 3.25-3.62 0-6.55-1.8-8.75-5.25Z" />
          <path d="m4.25 12-2.5-3.25v6.5L4.25 12Z" />
          <circle cx="13.75" cy="10.25" r=".75" fill="currentColor" stroke="none" />
        </>
      ) : null}
      {name === 'bait' ? (
        <>
          <path d="M13.5 3.25v10.5a4.75 4.75 0 1 1-4.75-4.75" />
          <path d="m10.5 4.75 3-1.5 2.25 2.25-2.25 1.5zM8.75 9v3" />
        </>
      ) : null}
      {name === 'search' ? (
        <>
          <circle cx="10.5" cy="10.5" r="6.25" />
          <path d="m15.25 15.25 4.5 4.5" />
        </>
      ) : null}
      {name === 'addCatch' ? (
        <>
          <path d="M3.5 10.25C5.2 7.7 7.5 6.4 10.3 6.4c2.2 0 4 .8 5.55 2.45l-2.35 1.4 2.35 1.4c-1.55 1.65-3.35 2.45-5.55 2.45-2.8 0-5.1-1.3-6.8-3.85Z" />
          <path d="m3.5 10.25-1.75-2.2v4.4l1.75-2.2Z" />
          <circle cx="10.9" cy="8.9" r=".65" fill="currentColor" stroke="none" />
          <path d="M18.25 14.25v6M15.25 17.25h6" />
        </>
      ) : null}
    </svg>
  );
}
