// Little Raft: inline SVG bodies (viewBox 0 0 48 48) for item kinds without a sprite in icons.svg (progression lane; 3D cached icons live in item-icons.js).
// Same palette as icons.svg: outline #153e49, wood #bb8650/#c99560, cream #fff2cc, teal #54a6a4/#9fd6d0, amber #ffbd66.
// Extra material tones: metal #6d8496/#9fb1bf/#c6d6e0, copper #a9542a/#d9773a/#f4a868, clay #c4643c, sand #e9b85a.
// Keys are normalised kinds (lowercase, no spaces/underscores/dashes). No ids, scripts or external refs.

const O = '#153e49';
// Shared bar geometry (ingots): front, end and top faces of one bar.
const BAR = (front, end, top) => `<path d="M4 38 H40 L35 24 H9 Z" fill="${front}"/><path d="M40 38 L44 34 L39 21 L35 24 Z" fill="${end}"/><path d="M9 24 H35 L39 21 H13 Z" fill="${top}"/>`;

export const ITEM_ICONS = Object.freeze({
  sand: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M4 41 C8 30 15 20 24 19 C33 20 40 30 44 41 Z" fill="#e9b85a"/>
    <path d="M12 31 C16 25 20 22 24 22 C28 22 33 25 37 31 C30 28 19 28 12 31 Z" fill="#f7d98a" stroke="none"/>
    <path d="M3 41 H45" fill="none"/></g>
    <path d="M15 27 C18 24 21 22.5 24 22.2" fill="none" stroke="#fff2cc" stroke-width="1.8" stroke-linecap="round"/>
    <g fill="${O}" fill-opacity=".45"><circle cx="17" cy="35" r="1"/><circle cx="23" cy="31" r="1"/><circle cx="30" cy="36" r="1"/><circle cx="35" cy="32" r=".9"/><circle cx="25" cy="38" r=".9"/><circle cx="11" cy="38" r=".9"/></g>
    <g fill="#e9b85a" stroke="${O}" stroke-width="1.2"><circle cx="37" cy="12" r="1.9"/><circle cx="42" cy="18" r="1.5"/><circle cx="33" cy="7" r="1.3"/></g>`,

  clay: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M8 33 C5 26 10 17 18 16 C21 11 30 10 34 15 C41 16 45 24 42 31 C44 37 38 42 30 41 H15 C9 41 6 37 8 33 Z" fill="#c4643c"/>
    <path d="M12 32 C11 27 14 23 19 22 C22 18 29 17 32 21 C37 22 39 27 37 30 C30 28 20 28 12 32 Z" fill="#df8a5d" stroke="none"/>
    <g fill="#a34c2c" stroke-width="1.3"><ellipse cx="22" cy="31" rx="3.4" ry="2.3"/><ellipse cx="31" cy="34" rx="2.7" ry="1.9"/></g></g>
    <path d="M16 20 C18.5 17 22 15.3 25.5 15.3" fill="none" stroke="#fff2cc" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M10 38 C14 39.5 20 40 26 39.6" fill="none" stroke="${O}" stroke-width="1" stroke-opacity=".45" stroke-linecap="round"/>`,

  stone: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M5 38 L8 23 L18 14 L30 16 L35 27 L32 39 Z" fill="#8f9aa0"/>
    <path d="M8 23 L18 14 L30 16 L22 23 Z" fill="#c1c9cc"/>
    <path d="M22 23 L35 27 M22 23 L18 39" fill="none" stroke-width="1.3" stroke-opacity=".6"/>
    <path d="M27 41 L30 31 L38 27 L45 31 L45 41 Z" fill="#7a858b"/>
    <path d="M30 31 L38 27 L45 31 L37 34 Z" fill="#a9b3b7"/>
    <path d="M3 41 H46" fill="none"/></g>
    <path d="M11 22.5 L18 17" stroke="#fff2cc" stroke-width="1.8" stroke-linecap="round"/>`,

  copperore: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M5 36 L8 22 L17 12 L31 11 L41 19 L44 33 L37 41 H11 Z" fill="#857a72"/>
    <path d="M8 22 L17 12 L31 11 L41 19 L28 21 L16 23 Z" fill="#a3978d"/>
    <g fill="#d9773a"><path d="M13 27 L19 22 L25 25 L23 32 L15 32 Z"/><path d="M28 27 L34 23 L39 29 L35 35 L28 33 Z"/><path d="M18 35 L23 34 L25 38 L19 39 Z"/><path d="M29 13 L35 14 L33 18.5 L27.5 17.5 Z"/></g></g>
    <path d="M15.5 27 L19 24.3 M30 26.8 L33.5 24.8" stroke="#f9c48e" stroke-width="1.6" stroke-linecap="round"/>
    <g fill="#6cc3a0" stroke="${O}" stroke-width=".8"><circle cx="21.5" cy="29" r="1.3"/><circle cx="36" cy="31" r="1.1"/></g>`,

  metalore: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M6 37 C4 27 9 16 20 13 C30 10 42 17 43 29 C44 36 40 41 34 41 H12 C8 41 6 40 6 37 Z" fill="#6f6a66"/>
    <path d="M9 24 C12 17 18 14 24 14 C30 14 36 17 39 22 C30 20 18 20 9 24 Z" fill="#8a847f" stroke="none"/>
    <g fill="#a9c0cf"><path d="M12 31 L17 22 L22 29 L18 35 Z"/><path d="M25 25 L31 17 L35 24 L30 30 Z"/><path d="M27 36 L33 30 L38 34 L34 39 Z"/></g></g>
    <path d="M14 30 L17 24.5 M27 24.5 L30.5 20 M29.5 36 L33 32.5" stroke="#eef6fa" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M38 9 V15 M35 12 H41" stroke="#eef6fa" stroke-width="1.6" stroke-linecap="round"/>`,

  nail: `<g transform="rotate(40 24 24)" stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M21 11 H27 V36 L24 45 L21 36 Z" fill="#9fb1bf"/>
    <rect x="13.5" y="4" width="21" height="7" rx="2.5" fill="#c6d6e0"/>
    <path d="M21 16 L27 14.5 M21 19 L27 17.5" fill="none" stroke-width="1.1" stroke-opacity=".5"/>
    <path d="M23 13 V35" fill="none" stroke="#fff2cc" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M16 6.8 H30" fill="none" stroke="#fff2cc" stroke-width="1.4" stroke-linecap="round"/></g>`,

  metalingot: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">${BAR('#8ea4b4', '#6d8496', '#c6d6e0')}
    <rect x="16" y="28" width="12" height="5" rx="1.2" fill="#7d93a3" stroke-width="1.3"/></g>
    <path d="M14 22.5 H34" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-opacity=".8"/>
    <path d="M10 35 L13 26" stroke="#fff2cc" stroke-width="1.5" stroke-linecap="round" stroke-opacity=".7"/>`,

  copperingot: `<g stroke="${O}" stroke-width="2.6" stroke-linejoin="round">
    <g transform="translate(2 13.5) scale(.75)">${BAR('#d9773a', '#a9542a', '#f4a868')}</g>
    <g transform="translate(11 2.5) scale(.75)">${BAR('#d9773a', '#a9542a', '#f4a868')}</g></g>
    <path d="M23 18.3 H36 M14 32.6 H27" stroke="#fff2cc" stroke-width="1.4" stroke-linecap="round" stroke-opacity=".85"/>`,

  glass: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M37 6 L41 9 L43 41 L39 38 Z" fill="#7cc9cc"/>
    <path d="M7 9 L37 6 L39 38 L9 42 Z" fill="#bfeef0" fill-opacity=".75"/></g>
    <g stroke="#fff" stroke-linecap="round" fill="none"><path d="M13 30 L25 12" stroke-width="3" stroke-opacity=".9"/><path d="M18 33 L28 18" stroke-width="1.6" stroke-opacity=".8"/><path d="M27 37 L33 28" stroke-width="1.4" stroke-opacity=".6"/></g>
    <path d="M10 12 L35 9.5" stroke="#fff" stroke-width="1.2" stroke-opacity=".7" stroke-linecap="round"/>
    <path d="M42 2 V8 M39 5 H45" stroke="#fff2cc" stroke-width="1.6" stroke-linecap="round"/>`,

  armor: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M5 16 L24 9 L43 16 L43 22 L24 15 L5 22 Z" fill="#c6d6e0"/>
    <path d="M5 22 L24 15 L43 22 V37 L24 43 L5 37 Z" fill="#9fb1bf"/>
    <path d="M24 15 V43" fill="none" stroke-width="1.5"/></g>
    <g fill="#4e6372" stroke="${O}" stroke-width="1.1"><circle cx="11" cy="27" r="1.9"/><circle cx="11" cy="34" r="1.9"/><circle cx="37" cy="27" r="1.9"/><circle cx="37" cy="34" r="1.9"/><circle cx="24" cy="21" r="1.6"/></g>
    <path d="M8 18.5 L24 12.6" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-opacity=".8"/>`,

  hinge: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <rect x="4" y="11" width="18" height="27" rx="2" fill="#9fb1bf"/>
    <path d="M26 12 L42 7 V40 L26 37 Z" fill="#7d93a3"/>
    <rect x="19.5" y="7" width="9" height="34" rx="4.5" fill="#c6d6e0"/>
    <path d="M19.5 18 H28.5 M19.5 30 H28.5" fill="none" stroke-width="1.5"/>
    <g fill="#4e6372" stroke-width="1.3"><circle cx="11" cy="17" r="2.2"/><circle cx="11" cy="32" r="2.2"/><circle cx="35" cy="14.5" r="2"/><circle cx="35" cy="32" r="2"/></g></g>
    <path d="M22 10 V38" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-opacity=".75"/>
    <path d="M7 14 V35" stroke="#fff2cc" stroke-width="1.3" stroke-linecap="round" stroke-opacity=".6"/>`,

  bolt: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <rect x="10.5" y="14" width="9" height="30" rx="1.5" fill="#9fb1bf"/>
    <path d="M10.5 19 L19.5 16.5 M10.5 23.5 L19.5 21 M10.5 28 L19.5 25.5 M10.5 32.5 L19.5 30 M10.5 37 L19.5 34.5 M10.5 41.5 L19.5 39" fill="none" stroke-width="1.3"/>
    <path d="M5 6 H25 V14 H5 Z" fill="#c6d6e0"/>
    <path d="M11.5 6 V14 M18.5 6 V14" fill="none" stroke-width="1.4"/>
    <path d="M35 20 L43.7 25 V35 L35 40 L26.3 35 V25 Z" fill="#9fb1bf"/>
    <circle cx="35" cy="30" r="4.3" fill="#4e6372"/></g>
    <path d="M7 8.5 V12" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M28.5 26 L34 22.8" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-opacity=".85"/>`,

  brick: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <rect x="3" y="28" width="20.5" height="13" rx="1.5" fill="#b5523a"/>
    <rect x="24.5" y="28" width="20.5" height="13" rx="1.5" fill="#a9492f"/>
    <rect x="12" y="13" width="24" height="14" rx="1.5" fill="#c45d40"/>
    <path d="M12 17.5 H36 M3 32 H23.5 M24.5 32 H45" fill="none" stroke-width="1.3"/></g>
    <g fill="#e48a68"><rect x="13" y="14" width="22" height="2.6"/><rect x="4" y="29" width="18.5" height="2.2"/><rect x="25.5" y="29" width="18.5" height="2.2"/></g>
    <g fill="${O}" fill-opacity=".4"><circle cx="18" cy="22" r="1"/><circle cx="29" cy="23" r="1"/><circle cx="9" cy="37" r="1"/><circle cx="17" cy="36" r=".9"/><circle cx="32" cy="37" r="1"/><circle cx="39" cy="35.5" r=".9"/></g>`,

  cookedfish: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M13 30 L4 22.5 L6.5 30 L4 37.5 Z" fill="#a8652e"/>
    <path d="M11 30 C17 19.5 34 18.5 43 30 C34 41.5 17 40.5 11 30 Z" fill="#cf8a45"/>
    <path d="M13 31.5 C20 37 34 37.5 42 31.8 C33 34.5 21 34.5 13 31.5 Z" fill="#e8b878" stroke-width="1.3"/>
    <path d="M19 23.5 L16 35 M25 21.7 L22 37 M31 22 L28 37" fill="none" stroke="#5a2f14" stroke-width="2.4"/>
    <path d="M35 25.5 l3 3 M38 25.5 l-3 3" fill="none" stroke-width="1.6"/></g>
    <g fill="none" stroke="#fff2cc" stroke-width="2" stroke-linecap="round" stroke-opacity=".9"><path d="M18 15 C16 12 20 10 18 6"/><path d="M26 14 C24 11 28 9 26 4"/><path d="M34 15 C32 12 36 10 34 6"/></g>`,

  sharkmeat: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M6 30 C5 21 13 14 24 14 C35 14 43 20 42 29 C41 37 33 41 23 40 C13 39 7 36 6 30 Z" fill="#d9767a"/>
    <path d="M10 28 C11 22 17 18 24 18 C31 18 37 22 38 27 C31 25 18 25 10 28 Z" fill="#f0a3a0" stroke="none"/>
    <path d="M6 30 C7 36 13 39 23 40 C33 41 41 37 42 29 C38 33 30 35 23 35 C15 35 9 33 6 30 Z" fill="#8a9ba6"/></g>
    <path d="M14 27 C18 24 24 23 30 24.5" fill="none" stroke="#fff2cc" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M18 31 C22 29 28 29 33 30.5" fill="none" stroke="#b5565c" stroke-width="1.4" stroke-linecap="round"/>`,

  // Grilled shark meat: the same slab seared brown with grill marks and steam.
  cookedsharkmeat: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M6 32 C5 23 13 17 24 17 C35 17 43 23 42 31 C41 39 33 43 23 42 C13 41 7 38 6 32 Z" fill="#b8693c"/>
    <path d="M10 30 C11 24 17 21 24 21 C31 21 37 24 38 29 C31 27 18 27 10 30 Z" fill="#d98e56" stroke="none"/>
    <path d="M6 32 C7 38 13 41 23 42 C33 43 41 39 42 31 C38 35 30 37 23 37 C15 37 9 35 6 32 Z" fill="#6d7880"/></g>
    <path d="M15 33 L19 23 M22 35 L26 22 M29 35 L33 23" fill="none" stroke="#4a2410" stroke-width="2.4" stroke-linecap="round"/>
    <g fill="none" stroke="#fff2cc" stroke-width="2" stroke-linecap="round" stroke-opacity=".9"><path d="M18 14 C16 11 20 9 18 5"/><path d="M26 13 C24 10 28 8 26 3"/><path d="M34 14 C32 11 36 9 34 5"/></g>`,

  sharkhead: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M4 30 C6 20 16 12 30 12 C38 12 44 18 44 26 L44 38 C36 40 26 40 18 38 C10 37 5 34 4 30 Z" fill="#7f8f99"/>
    <path d="M4 30 C10 34 20 36 30 35 C36 35 41 36 44 38 C36 40 26 40 18 38 C10 37 5 34 4 30 Z" fill="#eef2f0"/>
    <path d="M24 12 L30 3 L33 12 Z" fill="#6d7d87"/>
    <path d="M8 31 L12 34 L15 31.5 L18 34.5 L21 32 L24 35 L27 32.5" fill="#fff" stroke-width="1.3"/>
    <circle cx="16" cy="22.5" r="2.4" fill="${O}" stroke="none"/></g>
    <path d="M30 20 V30 M34 19.5 V30.5 M38 20 V30" stroke="${O}" stroke-width="1.4" stroke-linecap="round" stroke-opacity=".6"/>
    <path d="M12 17.5 C16 14.5 21 13.2 26 13.2" fill="none" stroke="#c6d6e0" stroke-width="1.8" stroke-linecap="round"/>`,

  metalhook: `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M24 8 C20 4 13 3 7 6" stroke="${O}" stroke-width="6"/><path d="M24 8 C20 4 13 3 7 6" stroke="#bb8650" stroke-width="3"/>
    <path d="M24 12 V37 M24 37 C17 39 11 35 10 26 M24 37 C31 39 37 35 38 26" stroke="${O}" stroke-width="8"/>
    <path d="M24 12 V37 M24 37 C17 39 11 35 10 26 M24 37 C31 39 37 35 38 26" stroke="#9fb1bf" stroke-width="4"/>
    <path d="M22.6 14 V34" stroke="#fff" stroke-width="1.3" stroke-opacity=".8"/>
    <circle cx="24" cy="9" r="3.6" stroke="${O}" stroke-width="5"/><circle cx="24" cy="9" r="3.6" stroke="#9fb1bf" stroke-width="2"/></g>
    <g fill="#c6d6e0" stroke="${O}" stroke-width="2" stroke-linejoin="round"><path d="M6.5 28 L10 18 L13.5 28 L10 26 Z"/><path d="M34.5 28 L38 18 L41.5 28 L38 26 Z"/><path d="M20.5 38 L24 46 L27.5 38 Z"/></g>`,

  // Wooden spear: driftwood shaft, chipped flint point lashed on with rope.
  spear: `<g transform="rotate(45 24 24)" stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M22 14 L21.4 51 Q24 53 26.6 51 L26 14 Z" fill="#bb8650"/>
    <path d="M24 -5 L29 4 L27.5 12 L26 15 H22 L20.5 12 L19 4 Z" fill="#7d7a73"/>
    <path d="M24 -5 L26.5 4 L24 13 L21.5 4 Z" fill="#a6a29a" stroke-width="1.1" stroke-opacity=".6"/>
    <path d="M22.3 0 L21 5" fill="none" stroke="#fff2cc" stroke-width="1.3" stroke-linecap="round"/>
    <g fill="#d9c38c" stroke-width="1.4"><path d="M19.8 13 L28.2 15.5 V18 L19.8 15.5 Z"/><path d="M19.8 17 L28.2 19.5 V22 L19.8 19.5 Z"/></g>
    <path d="M23 26 V33 M25 38 V45" fill="none" stroke-width="1" stroke-opacity=".45"/>
    <path d="M22.8 24 V48" fill="none" stroke="#c99560" stroke-width="1.2" stroke-linecap="round"/></g>`,

  // Metal spear: leaf-shaped steel point on a bolted collar.
  metalspear: `<g transform="rotate(45 24 24)" stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <rect x="21.5" y="13" width="5" height="39" rx="2.5" fill="#c99560"/>
    <path d="M24 -6 C29.5 0 29.5 7 24 14 C18.5 7 18.5 0 24 -6 Z" fill="#9fb1bf"/>
    <path d="M24 -3 V11" fill="none" stroke-width="1.2" stroke-opacity=".6"/>
    <path d="M22.5 -1 C21 2 21 6 22.5 9" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>
    <g fill="#fff2cc" stroke-width="1.5"><rect x="20" y="13.5" width="8" height="3" rx="1.5"/><rect x="20" y="16.8" width="8" height="3" rx="1.5"/></g>
    <path d="M24 24 V31 M24 37 V44" fill="none" stroke-width="1" stroke-opacity=".45"/></g>`,

  axe: `<g transform="rotate(25 24 24)" stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <rect x="21" y="8" width="6" height="38" rx="3" fill="#c99560"/>
    <path d="M22 9 C15 7 9 8 5 10 C4 16 4.5 23 7 29 C11 25 16 22 22 21 Z" fill="#9fb1bf"/>
    <path d="M26.5 10 H31 V19 H26.5 Z" fill="#7d93a3"/>
    <path d="M7.5 12 C6.8 17 7.2 22 8.8 26" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
    <g fill="#bb8650" stroke-width="1.5"><rect x="19.5" y="9" width="9" height="3" rx="1.5"/><rect x="19.5" y="18" width="9" height="3" rx="1.5"/></g>
    <path d="M24 27 V33 M24 38 V42" fill="none" stroke-width="1" stroke-opacity=".45"/></g>`,

  binoculars: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <rect x="9" y="5" width="10" height="11" rx="2" fill="#2f6f73"/><rect x="29" y="5" width="10" height="11" rx="2" fill="#2f6f73"/>
    <rect x="18" y="16" width="12" height="9" rx="2" fill="#ffbd66"/>
    <rect x="4" y="13" width="18" height="30" rx="6" fill="#54a6a4"/><rect x="26" y="13" width="18" height="30" rx="6" fill="#54a6a4"/>
    <path d="M4 22 H22 M26 22 H44" fill="none" stroke-width="1.6"/>
    <circle cx="13" cy="33" r="6.5" fill="#bdeef0"/><circle cx="35" cy="33" r="6.5" fill="#bdeef0"/></g>
    <g fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><path d="M10 31 C10.5 29.5 11.5 28.8 13 28.5"/><path d="M32 31 C32.5 29.5 33.5 28.8 35 28.5"/></g>
    <path d="M7 16 V21 M29 16 V21" stroke="#9fd6d0" stroke-width="1.5" stroke-linecap="round"/>`,

  // [instruments] Tide Drum, Reed Pipes, Bell Bars
  drum: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M7 17 L10 39 C14 43 34 43 38 39 L41 17 Z" fill="#bb8650"/>
    <ellipse cx="24" cy="17" rx="17" ry="6" fill="#7da35a"/></g>
    <path d="M13 16 C17 14 22 13.5 26 13.8" fill="none" stroke="#b8d88f" stroke-width="1.8" stroke-linecap="round"/>
    <g fill="none" stroke="#e8cf9a" stroke-width="2" stroke-linecap="round"><path d="M11 22 L18 38 M24 23.5 V41 M37 22 L30 38"/><path d="M8.5 28 C16 32 32 32 39.5 28" stroke="${O}" stroke-width="1.4"/></g>`,
  pipes: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <rect x="5" y="6" width="7" height="36" rx="3" fill="#8fc3c9"/><rect x="12.5" y="6" width="7" height="31" rx="3" fill="#a5d4d8"/>
    <rect x="20" y="6" width="7" height="26" rx="3" fill="#8fc3c9"/><rect x="27.5" y="6" width="7" height="21" rx="3" fill="#a5d4d8"/>
    <rect x="35" y="6" width="7" height="16" rx="3" fill="#8fc3c9"/>
    <rect x="3" y="11" width="41" height="5" rx="2" fill="#c9a46a"/></g>
    <g fill="${O}"><circle cx="8.5" cy="8.5" r="1.3"/><circle cx="16" cy="8.5" r="1.3"/><circle cx="23.5" cy="8.5" r="1.3"/><circle cx="31" cy="8.5" r="1.3"/><circle cx="38.5" cy="8.5" r="1.3"/></g>`,
  bells: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <rect x="4" y="15" width="40" height="4" rx="1.5" fill="#bb8650"/><rect x="4" y="31" width="40" height="4" rx="1.5" fill="#bb8650"/>
    <rect x="7" y="7" width="7" height="36" rx="1.5" fill="#c9b26a"/><rect x="16.5" y="10" width="7" height="30" rx="1.5" fill="#d8c27a"/>
    <rect x="26" y="13" width="7" height="24" rx="1.5" fill="#c9b26a"/><rect x="35.5" y="16" width="7" height="18" rx="1.5" fill="#d8c27a"/></g>
    <path d="M9.5 10 V22 M19 13 V22 M28.5 16 V24" stroke="#fff2cc" stroke-width="1.5" stroke-linecap="round"/>`,
  finder: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M11 43 L27 21" fill="none" stroke-width="7"/><path d="M11 43 L27 21" fill="none" stroke="#c99560" stroke-width="4"/>
    <path d="M12.5 41 L16.5 35.5" fill="none" stroke="#fff2cc" stroke-width="3.5" stroke-linecap="butt"/>
    <ellipse cx="32" cy="15" rx="12" ry="9" fill="#ffbd66" transform="rotate(-25 32 15)"/>
    <ellipse cx="32" cy="15" rx="7" ry="4.6" fill="#54a6a4" transform="rotate(-25 32 15)"/>
    <circle cx="25" cy="24" r="3" fill="#ffbd66"/></g>
    <path d="M27 11 C29 9.5 32 8.8 35 9" fill="none" stroke="#fff2cc" stroke-width="1.6" stroke-linecap="round"/>
    <g fill="none" stroke="#ffbd66" stroke-width="1.8" stroke-linecap="round"><path d="M41 31 C43 33 43.5 36 42.5 38.5"/><path d="M37 33 C38.3 34.3 38.6 36 38 37.6"/></g>`,

  spade: `<g transform="rotate(35 24 24)" stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M18 3 H30 V8 C30 10.5 28 12 25.5 12 H22.5 C20 12 18 10.5 18 8 Z" fill="#c99560"/>
    <rect x="21" y="5.5" width="6" height="3.5" rx="1.5" fill="#153e49" fill-opacity=".4" stroke="none"/>
    <rect x="21.5" y="11" width="5" height="17" rx="2" fill="#bb8650"/>
    <g fill="#d9c38c" stroke-width="1.3"><rect x="20.8" y="15" width="6.4" height="2.4" rx="1"/><rect x="20.8" y="18.6" width="6.4" height="2.4" rx="1"/></g>
    <rect x="20" y="26.5" width="8" height="4" rx="1.5" fill="#6d8496"/>
    <path d="M15 30 H33 V36 C33 41.5 28.5 45.5 24 45.5 C19.5 45.5 15 41.5 15 36 Z" fill="#9fb1bf"/>
    <path d="M18 33 C17.6 36.5 18.6 39.5 21 41.5" fill="none" stroke="#fff" stroke-width="1.6"/></g>
    <g fill="#e9b85a" stroke="${O}" stroke-width="1.2"><circle cx="33" cy="43" r="2"/><circle cx="39" cy="44.5" r="1.6"/><circle cx="43" cy="40.5" r="1.4"/></g>`,

  smelter: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <rect x="29" y="3" width="8" height="12" rx="1" fill="#7a858b"/>
    <path d="M7 42 V25 C7 14 14.5 8 24 8 C33.5 8 41 14 41 25 V42 Z" fill="#8f9aa0"/>
    <path d="M7 25 H16 M32 25 H41 M7 34 H15 M33 34 H41 M15 16 L18 22 M30 14 L28 20 M24 8 V14" fill="none" stroke-width="1.3" stroke-opacity=".65"/>
    <path d="M15 42 V33 C15 27.5 19 24 24 24 C29 24 33 27.5 33 33 V42 Z" fill="#ff8a3d"/>
    <path d="M18.5 42 C17 37 21 35 21 31 C24 33 23 28 26 27 C26 31 30 33 29.5 37 C29.5 39 29 41 28.5 42 Z" fill="#ffbd66" stroke-width="1.4"/>
    <path d="M4 42 H44" fill="none"/></g>
    <path d="M11 22 C12 17 15 13.5 19 11.5" fill="none" stroke="#fff2cc" stroke-width="1.6" stroke-linecap="round" stroke-opacity=".8"/>`,

  maptable: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <rect x="8" y="27" width="5" height="16" rx="1" fill="#bb8650"/><rect x="35" y="27" width="5" height="16" rx="1" fill="#bb8650"/>
    <path d="M3 21 H45 V27 H3 Z" fill="#c99560"/>
    <path d="M6 21 L9 10 H33 L30 21 Z" fill="#fff2cc"/>
    <path d="M12 18 C15 14 18 17 21 13.5 S27 14 29 12" fill="none" stroke="#bb8650" stroke-width="1.4" stroke-dasharray="2 2"/>
    <path d="M22.5 15.2 L25.5 12.2 M22.5 12.2 L25.5 15.2" fill="none" stroke="#e85a4f" stroke-width="1.6" stroke-linecap="round"/>
    <rect x="34" y="14" width="10" height="5" rx="2.5" fill="#e8d6a8"/>
    <ellipse cx="13.5" cy="16" rx="2.6" ry="1.8" fill="#9fd6d0" stroke-width="1.2"/></g>
    <circle cx="40" cy="11" r="2.4" fill="#d9773a" stroke="${O}" stroke-width="1.4"/>
    <path d="M10 12.5 L17 12.5" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-opacity=".7"/>`,

  researchtable: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <rect x="8" y="26" width="5" height="17" rx="1" fill="#bb8650"/><rect x="35" y="26" width="5" height="17" rx="1" fill="#bb8650"/>
    <rect x="3" y="20" width="42" height="7" rx="1.5" fill="#c99560"/>
    <path d="M7 20 L10 9 L27 11 L25 20 Z" fill="#fff2cc"/>
    <path d="M11 13 L24 14.5 M10.5 16 L18 16.8" fill="none" stroke="#54a6a4" stroke-width="1.6"/>
    <path d="M33 6 H38 V10 L43 20 H28 L33 10 Z" fill="#9fd6d0"/>
    <path d="M30.5 15 H40.5 L43 20 H28 Z" fill="#ffbd66" stroke-width="1.3"/></g>
    <path d="M34.5 10.5 L32 15" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M15 31 V39 M38 30 V35" stroke="${O}" stroke-width="1" stroke-opacity=".4" stroke-linecap="round"/>`,

  grill: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M13 31 L8 44 M35 31 L40 44 M24 33 V44" fill="none" stroke-width="3.2"/>
    <path d="M20 21 C17 17 21 14 19 9 C23 11 25 7 24 3 C29 7 27 11 30 13 C31 10 33 10 33 9 C35 14 32 18 29 21 Z" fill="#ff8a3d"/>
    <path d="M22 21 C21 18 24 17 24 13 C26 16 27 18 27 21 Z" fill="#ffbd66" stroke-width="1.4"/>
    <path d="M5 23 H43 L38 33 H10 Z" fill="#4e6372"/>
    <rect x="3" y="19.5" width="42" height="4.5" rx="2.25" fill="#9fb1bf"/></g>
    <path d="M10 20.5 V23 M17 20.5 V23 M24 20.5 V23 M31 20.5 V23 M38 20.5 V23" stroke="${O}" stroke-width="1.4"/>
    <path d="M12 27 H30" stroke="#9fb1bf" stroke-width="1.4" stroke-linecap="round" stroke-opacity=".7"/>`,

  fishingrod: `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M42 5 C44 15 42 24 39 29" stroke="${O}" stroke-width="1.3"/>
    <path d="M6 43 C16 31 29 17 42 5" stroke="${O}" stroke-width="5.5"/><path d="M6 43 C16 31 29 17 42 5" stroke="#c99560" stroke-width="2.6"/>
    <path d="M5.5 43.5 L13.5 34.5" stroke="${O}" stroke-width="8"/><path d="M5.5 43.5 L13.5 34.5" stroke="#ffbd66" stroke-width="4.5"/></g>
    <g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <circle cx="20" cy="34" r="4.6" fill="#54a6a4"/><circle cx="20" cy="34" r="1.4" fill="#fff2cc" stroke-width="1.2"/>
    <path d="M34 33 A5 5 0 0 1 44 33 Z" fill="#e85a4f"/><path d="M34 33 A5 5 0 0 0 44 33 Z" fill="#fff2cc"/></g>
    <path d="M39 28 V29" stroke="${O}" stroke-width="2" stroke-linecap="round"/>`,

  bench: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M9 25 L5 44 H11 L14 25 Z M39 25 L43 44 H37 L34 25 Z" fill="#bb8650"/>
    <rect x="9" y="34" width="30" height="4" rx="1" fill="#bb8650"/>
    <path d="M13 17 L36 10 V17 Z" fill="#c6d6e0"/>
    <rect x="35" y="8" width="7" height="10" rx="2" fill="#ffbd66"/>
    <rect x="2" y="17" width="44" height="9" rx="1.5" fill="#c99560"/>
    <path d="M17 17 V26 M32 17 V26" fill="none" stroke-width="1.3"/></g>
    <path d="M16 15.2 L34 10.6" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-opacity=".8"/>
    <path d="M7 21.5 H13 M22 21.5 H27 M36 21.5 H41" stroke="${O}" stroke-width="1" stroke-opacity=".45" stroke-linecap="round"/>`,

  crate: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M6 17 L16 8 H42 L32 17 Z" fill="#d9a873"/>
    <path d="M32 17 L42 8 V33 L32 42 Z" fill="#9a6a3c"/>
    <rect x="6" y="17" width="26" height="25" fill="#bb8650"/>
    <rect x="10" y="21" width="18" height="17" fill="#c99560" stroke-width="1.5"/></g>
    <path d="M11 37 L27 22" stroke="${O}" stroke-width="6" stroke-linecap="round"/><path d="M11 37 L27 22" stroke="#bb8650" stroke-width="3" stroke-linecap="round"/>
    <path d="M35 18 L39 14.5 M35 30 L39 26.5" stroke="${O}" stroke-width="1.2" stroke-opacity=".5" stroke-linecap="round"/>
    <g fill="#fff2cc"><circle cx="8" cy="19" r=".9"/><circle cx="30" cy="19" r=".9"/><circle cx="8" cy="40" r=".9"/><circle cx="30" cy="40" r=".9"/></g>`,

  // [bees] flower seed, flower box, beehive, honey, beeswax, candle, honey glazed fish
  flowerseed: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M24 44 C15 44 11 37 13 31 C15 25 20 22 24 17 C28 22 33 25 35 31 C37 37 33 44 24 44 Z" fill="#c99560"/>
    <path d="M24 17 V9" fill="none" stroke="#3f8f5a" stroke-width="2.4"/>
    <path d="M24 11 C20 5 13 5 11 8 C14 12 20 13 24 11 Z" fill="#7cc47f"/><path d="M24 9 C27 4 34 3 37 6 C34 10 28 11 24 9 Z" fill="#5fae6b"/></g>
    <path d="M18 33 C18.5 29 20.5 26.5 23 24.5" fill="none" stroke="#fff2cc" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="40" cy="16" r="2.4" fill="#ff7aa2" stroke="${O}" stroke-width="1.2"/>`,

  flowerbox: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M12 28 V18 M24 28 V13 M36 28 V18" fill="none" stroke="#3f8f5a" stroke-width="2.2"/>
    <g stroke-width="1.6"><circle cx="12" cy="15" r="5" fill="#ff7aa2"/><circle cx="24" cy="10" r="5" fill="#ffd35a"/><circle cx="36" cy="15" r="5" fill="#9b7bff"/></g>
    <g fill="#ffbd66" stroke-width="1.2"><circle cx="12" cy="15" r="1.8"/><circle cx="24" cy="10" r="1.8"/><circle cx="36" cy="15" r="1.8"/></g>
    <path d="M4 28 H44 L41 43 H7 Z" fill="#bb8650"/>
    <path d="M4 28 H44 V32 H4 Z" fill="#5a3d28"/></g>
    <path d="M10 37 H38" stroke="${O}" stroke-width="1.1" stroke-opacity=".45" stroke-linecap="round"/>`,

  beehive: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <rect x="5" y="39" width="38" height="5" rx="1.5" fill="#9c7649"/>
    <path d="M9 39 C8 33 9 28 11 25 H37 C39 28 40 33 39 39 Z" fill="#d9a441"/>
    <path d="M11 25 C11 20 13 17 15 15 H33 C35 17 37 20 37 25 Z" fill="#c58f32"/>
    <path d="M15 15 C16 9 20 6 24 6 C28 6 32 9 33 15 Z" fill="#d9a441"/>
    <path d="M18 39 V33 A6 6 0 0 1 30 33 V39 Z" fill="#3b2a1a"/></g>
    <path d="M16 11 C17.5 9 19.5 8 21.5 7.8" fill="none" stroke="#fff2cc" stroke-width="1.8" stroke-linecap="round"/>
    <g stroke="${O}" stroke-width="1"><ellipse cx="41" cy="12" rx="3" ry="2.2" fill="#f5c542"/><ellipse cx="40" cy="9" rx="2" ry="1.4" fill="#fff"/></g>`,

  honey: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M10 18 C8 26 8 36 12 42 H32 C36 36 36 26 34 18 Z" fill="#f2b134"/>
    <rect x="9" y="13" width="26" height="6" rx="2" fill="#bb8650"/>
    <path d="M38 4 L32 20" fill="none" stroke="#9c7649" stroke-width="2.6"/>
    <ellipse cx="39" cy="4.5" rx="3.6" ry="2.6" fill="#c99560" transform="rotate(-20 39 4.5)"/></g>
    <path d="M14 24 C13 29 13.5 34 15 38" fill="none" stroke="#ffe39a" stroke-width="2" stroke-linecap="round"/>
    <path d="M17 19 V24 C17 26 20 26 20 24 V19" fill="#f2b134" stroke="${O}" stroke-width="1.4"/>`,

  wax: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M24 5 L40 14 V33 L24 42 L8 33 V14 Z" fill="#f3e2a4"/>
    <path d="M24 5 L40 14 L24 23 L8 14 Z" fill="#fff2cc"/>
    <path d="M24 23 V42" fill="none" stroke-width="1.4"/></g>
    <g fill="none" stroke="#d9b65a" stroke-width="1.3" stroke-linejoin="round"><path d="M17 12 L20 10.5 L23 12 L23 15 L20 16.5 L17 15 Z"/><path d="M25 12 L28 10.5 L31 12 L31 15 L28 16.5 L25 15 Z"/></g>
    <path d="M11 20 V30" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-opacity=".8"/>`,

  candle: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M24 5 C28 10 29 14 27 17 C26 19 22 19 21 17 C19 14 21 10 24 5 Z" fill="#ffbd66"/>
    <path d="M24 11 C25.5 13 25.5 15 24 16 C22.5 15 22.5 13 24 11 Z" fill="#fff2cc" stroke-width="1"/>
    <path d="M24 19 V22" fill="none" stroke-width="1.5"/>
    <rect x="15" y="22" width="18" height="18" rx="2" fill="#fff2cc"/>
    <path d="M10 18 V40 C10 43 13 44 16 44 H32 C35 44 38 43 38 40 V18" fill="#9fd6d0" fill-opacity=".45"/></g>
    <path d="M13 22 V37" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-opacity=".8"/>`,

  honeyfish: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M6 26 C12 15 28 14 36 24 L44 17 V35 L36 28 C28 38 12 37 6 26 Z" fill="#d98a4e"/>
    <path d="M14 22 L18 31 M21 20 L25 32 M28 21 L31 30" fill="none" stroke="#8a4a22" stroke-width="2"/>
    <path d="M9 23 C15 20 22 24 27 21 C30 19 33 21 34 23 L33 26 C31 25 30 28 30 31 C28 27 24 27 22 29 C21 26 17 26 14 28 C13 25 11 25 9 26 Z" fill="#f2b134" stroke-width="1.4"/></g>
    <circle cx="12" cy="24" r="1.4" fill="${O}"/>
    <path d="M17 22 C20 21 22 21.5 24 22" fill="none" stroke="#ffe39a" stroke-width="1.5" stroke-linecap="round"/>`,

  seaweed: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M16 44 C8 36 18 29 12 21 C8 15 11 9 14 4 C23 9 21 16 25 22 C29 30 22 36 24 44 Z" fill="#3f8f5a"/>
    <path d="M25 44 C21 35 30 30 27 20 C26 14 30 9 36 7 C39 15 35 19 37 25 C39 33 32 37 33 44 Z" fill="#5fae6b"/>
    <path d="M8 44 C6 38 10 35 8 29 C11 31 14 35 13 39 C13 41 14 43 15 44 Z" fill="#7cc47f"/>
    <path d="M2 44 H46" fill="none"/></g>
    <g fill="none" stroke="${O}" stroke-width="1.1" stroke-opacity=".55" stroke-linecap="round"><path d="M16 9 C18 16 16 24 20 33"/><path d="M32 12 C31 20 32 28 28 38"/></g>
    <g fill="#bdeef0" stroke="${O}" stroke-width="1.2"><circle cx="40" cy="16" r="2.6"/><circle cx="42" cy="26" r="1.6"/><circle cx="8" cy="15" r="1.8"/></g>`,

  // [raiders] seagull drumstick (raw, grilled) and the scarecrow
  drumstick: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M30 8 C39 8 44 15 42 23 C40 31 32 34 26 31 L18 37 C16 39 13 39 12 37 C9 38 7 35 9 33 C8 31 10 28 13 29 L19 23 C15 16 21 8 30 8 Z" fill="#eaa18f"/>
    <path d="M18 37 C16 39 13 39 12 37 C9 38 7 35 9 33 C8 31 10 28 13 29 L15 31 L16 35 Z" fill="#fff2cc"/></g>
    <path d="M26 13 C30 11.5 35 12 38 15" fill="none" stroke="#ffd3c4" stroke-width="1.8" stroke-linecap="round"/>
    <g fill="#c96f62"><circle cx="31" cy="21" r="1.2"/><circle cx="36" cy="18" r="1"/><circle cx="27" cy="25" r="1"/></g>`,

  cookeddrumstick: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M30 11 C39 11 44 18 42 26 C40 34 32 37 26 34 L18 40 C16 42 13 42 12 40 C9 41 7 38 9 36 C8 34 10 31 13 32 L19 26 C15 19 21 11 30 11 Z" fill="#c07a3e"/>
    <path d="M18 40 C16 42 13 42 12 40 C9 41 7 38 9 36 C8 34 10 31 13 32 L15 34 L16 38 Z" fill="#fff2cc"/></g>
    <path d="M25 30 L31 17 M31 31 L37 19" fill="none" stroke="#5a2f14" stroke-width="2.2" stroke-linecap="round"/>
    <g fill="none" stroke="#fff2cc" stroke-width="2" stroke-linecap="round" stroke-opacity=".9"><path d="M28 9 C26 6 30 4 28 1"/><path d="M37 9 C35 6 39 4 37 1"/></g>`,

  scarecrow: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M24 16 V45" fill="none" stroke="#8d5f36" stroke-width="3.2"/>
    <path d="M6 22 H42" fill="none" stroke="#8d5f36" stroke-width="3"/>
    <path d="M15 19 H33 L35 36 H13 Z" fill="#54a6a4"/>
    <path d="M6 19.5 H15 V25 H8 Z M33 19.5 H42 L40 25 H33 Z" fill="#9fd6d0"/>
    <path d="M4 20 L6 27 M4 24 L8 27 M44 20 L42 27 M44 24 L40 27" fill="none" stroke="#e0b45a" stroke-width="1.8"/>
    <circle cx="24" cy="11" r="6.5" fill="#e9c46a"/>
    <path d="M14 7 H34 L28 5 L26 0.5 H22 L20 5 Z" fill="#c99560"/></g>
    <g fill="${O}"><circle cx="21.5" cy="11" r="1.1"/><circle cx="26.5" cy="11" r="1.1"/></g>
    <path d="M20.5 14.2 L22 13.6 L23.5 14.4 L25 13.6 L26.5 14.4 L28 13.8" fill="none" stroke="${O}" stroke-width="1.1"/>
    <path d="M17 28 L21 30 M27 26 L31 29" fill="none" stroke="#fff2cc" stroke-width="1.3" stroke-opacity=".8"/>`,

  // [crops] beet, potato, grilled beet, baked potato, small crop plot
  beet: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M22 17 C16 11 12 6 14 3 C18 3 22 9 23 16 Z" fill="#5fae6b"/><path d="M26 17 C30 10 35 5 38 7 C38 11 32 15 27 18 Z" fill="#4f9a5c"/>
    <path d="M24 17 V6" fill="none" stroke="#b23a55" stroke-width="2.2"/>
    <path d="M24 17 C33 17 39 23 38 30 C37 37 30 41 25 45 C19 41 11 37 10 30 C9 23 15 17 24 17 Z" fill="#a8324a"/></g>
    <path d="M15 26 C16 22.5 19 20.5 22.5 20" fill="none" stroke="#f08aa0" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M18 33 C22 34 27 34 31 32" fill="none" stroke="#6e1a30" stroke-width="1.2" stroke-linecap="round"/>`,

  potato: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M7 27 C6 19 13 13 22 13 C30 12 41 15 42 24 C43 32 37 38 27 39 C16 40 8 35 7 27 Z" fill="#c9a46a"/></g>
    <path d="M12 24 C13 19.5 17 17 22 16.5" fill="none" stroke="#f1dca8" stroke-width="1.8" stroke-linecap="round"/>
    <g fill="#8a6a3c"><circle cx="19" cy="26" r="1.4"/><circle cx="29" cy="21" r="1.2"/><circle cx="33" cy="30" r="1.4"/><circle cx="23" cy="33" r="1.1"/></g>`,

  cookedbeet: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M24 15 C33 15 39 21 38 28 C37 35 30 39 25 43 C19 39 11 35 10 28 C9 21 15 15 24 15 Z" fill="#7e2438"/>
    <path d="M16 31 L22 19 M23 34 L29 19 M30 31 L34 23" fill="none" stroke="#3a0e18" stroke-width="2.2"/></g>
    <g fill="none" stroke="#fff2cc" stroke-width="2" stroke-linecap="round" stroke-opacity=".9"><path d="M18 12 C16 9 20 7 18 3"/><path d="M28 11 C26 8 30 6 28 2"/></g>`,

  cookedpotato: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M7 29 C6 21 13 16 22 16 C30 15 41 18 42 26 C43 34 37 39 27 40 C16 41 8 37 7 29 Z" fill="#b77a3a"/>
    <path d="M15 26 C19 22 27 21 33 24 C30 28 22 30 15 26 Z" fill="#fbe7a6"/>
    <path d="M22 25.5 C24 24.5 26 24.5 28 25.5" fill="none" stroke="#ffd35a" stroke-width="2.4"/></g>
    <g fill="none" stroke="#fff2cc" stroke-width="2" stroke-linecap="round" stroke-opacity=".9"><path d="M18 13 C16 10 20 8 18 4"/><path d="M28 12 C26 9 30 7 28 3"/></g>`,

  cropplot: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M10 22 V16 M24 22 V12 M38 22 V16" fill="none" stroke="#3f8f4a" stroke-width="2.2"/>
    <path d="M10 17 C6 13 6 10 8 9 C11 11 11 14 10 17 Z M24 13 C20 8 21 5 23 4 C26 6 26 9 24 13 Z M24 14 C28 9 31 9 32 10 C31 13 28 14 24 14 Z M38 17 C42 13 42 10 40 9 C37 11 37 14 38 17 Z" fill="#5fae6b"/>
    <path d="M3 24 H45 V40 H3 Z" fill="#9a6a3e"/>
    <path d="M3 24 H45 V28 H3 Z" fill="#3b291b"/></g>
    <path d="M3 33 H45" stroke="${O}" stroke-width="1.2" stroke-opacity=".5"/>
    <g fill="#21160d"><ellipse cx="10" cy="26" rx="4" ry="1.3"/><ellipse cx="24" cy="26" rx="4" ry="1.3"/><ellipse cx="38" cy="26" rx="4" ry="1.3"/></g>`,
});
