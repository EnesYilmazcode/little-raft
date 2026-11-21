// Little Raft: inline SVG bodies (viewBox 0 0 48 48) for item kinds without a sprite in icons.svg (progression lane; 3D cached icons live in item-icons.js).
// Same palette as icons.svg: outline #153e49, wood #bb8650/#c99560, cream #fff2cc, teal #54a6a4/#9fd6d0, amber #ffbd66.
// Extra material tones: metal #6d8496/#9fb1bf/#c6d6e0, copper #a9542a/#d9773a/#f4a868, clay #c4643c, sand #e9b85a.
// Keys are normalised kinds (lowercase, no spaces/underscores/dashes). No ids, scripts or external refs.

const O = '#153e49';
// Shared bar geometry (ingots): front, end and top faces of one bar.
const BAR = (front, end, top) => `<path d="M4 38 H40 L35 24 H9 Z" fill="${front}"/><path d="M40 38 L44 34 L39 21 L35 24 Z" fill="${end}"/><path d="M9 24 H35 L39 21 H13 Z" fill="${top}"/>`;

export const ITEM_ICONS = Object.freeze({
  receiver: `<path d="M30 21 L37 4" stroke="${O}" stroke-width="4" stroke-linecap="round"/>
    <path d="M30 21 L37 4" stroke="#c0c6c8" stroke-width="2" stroke-linecap="round"/>
    <circle cx="37" cy="4.5" r="2.4" fill="#ffbd66" stroke="${O}" stroke-width="1.6"/>
    <g stroke="${O}" stroke-width="2" stroke-linejoin="round">
      <rect x="5" y="19" width="38" height="23" rx="3" fill="#8c6745"/>
      <path d="M5 24 H43" fill="none" stroke-width="1.2" stroke-opacity=".5"/>
      <rect x="9" y="26" width="19" height="11" rx="1.5" fill="#1f4a52"/>
      <circle cx="35.5" cy="31.5" r="4.6" fill="#ffbd66"/>
      <path d="M35.5 31.5 L37.8 28.6" fill="none" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M9 42 V45 M39 42 V45" fill="none" stroke-width="3" stroke-linecap="round"/>
    </g>
    <path d="M12 33.5 C14 29 16 29 18 32 C20 35 22 35 25 29" fill="none" stroke="#7fe0c8" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M8 21.5 H24" stroke="#fff2cc" stroke-width="1.6" stroke-linecap="round" stroke-opacity=".6"/>`,

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

  // Paddle: driftwood shaft with a T-grip, plank blade with a plastic wear patch.
  paddle: `<g transform="rotate(40 24 24)" stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M18 1 H30" fill="none" stroke-width="5" stroke-linecap="round"/><path d="M18 1 H30" fill="none" stroke="#bb8650" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="22" y="1" width="4" height="28" rx="2" fill="#bb8650"/>
    <rect x="21" y="8" width="6" height="6" rx="2" fill="#d9c38c" stroke-width="1.5"/>
    <path d="M22 27 C17 29 16 33 16 40 C16 46 19 49 24 49 C29 49 32 46 32 40 C32 33 31 29 26 27 Z" fill="#c99560"/>
    <rect x="19.5" y="35" width="9" height="8" rx="1.5" fill="#fff2cc" stroke-width="1.5"/>
    <path d="M19 31 C18 34 18 38 18.5 41" fill="none" stroke="#fff2cc" stroke-width="1.3" stroke-linecap="round"/></g>`,

  // Stone axe: driftwood handle, chipped grey stone head lashed on with rope.
  axe: `<g transform="rotate(25 24 24)" stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M22 8 L21.2 45 Q24 47 26.8 45 L26 8 Z" fill="#bb8650"/>
    <path d="M22.5 10 L13 6 L5.5 9 L4 17 L6.5 25 L13 24 L22.5 20 Z" fill="#8f9aa0"/>
    <path d="M13 6 L5.5 9 L4 17 L9 15 L13 10 Z" fill="#c1c9cc" stroke-width="1.2"/>
    <path d="M6.2 11 L5.2 18" fill="none" stroke="#fff2cc" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M12 13 L16 15 M10 20 L14 19" fill="none" stroke-width="1" stroke-opacity=".5"/>
    <g fill="#d9c38c" stroke-width="1.4"><path d="M20 9 L28 11.5 V14 L20 11.5 Z"/><path d="M20 14 L28 16.5 V19 L20 16.5 Z"/><path d="M20 19 L28 21.5 V24 L20 21.5 Z"/></g>
    <path d="M23 30 V36 M25 39 V43" fill="none" stroke-width="1" stroke-opacity=".45"/>
    <path d="M22.8 27 V43" fill="none" stroke="#c99560" stroke-width="1.2" stroke-linecap="round"/></g>`,

  // Coconut: hairy brown husk with three dark eyes and a highlight.
  coconut: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M24 7 C35 7 42 15 42 26 C42 36 34 42 24 42 C14 42 6 36 6 26 C6 15 13 7 24 7 Z" fill="#7a5130"/>
    <path d="M24 10 C32 10 38 16 39 23 C33 19 15 19 9 23 C10 16 16 10 24 10 Z" fill="#9a6a40" stroke="none"/>
    <g fill="#3e2716" stroke-width="1"><circle cx="19" cy="15.5" r="2.2"/><circle cx="29" cy="15.5" r="2.2"/><circle cx="24" cy="21" r="2.2"/></g></g>
    <path d="M12 28 L15 31 M17 34 L20 36 M31 34 L28 36.5 M36 28 L33 31 M24 37 V39.5" stroke="#4e321c" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M11 20 C12.5 16 15.5 13 19 11.5" fill="none" stroke="#fff2cc" stroke-width="1.8" stroke-linecap="round" stroke-opacity=".8"/>`,


  binoculars: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <rect x="9" y="5" width="10" height="11" rx="2" fill="#2f6f73"/><rect x="29" y="5" width="10" height="11" rx="2" fill="#2f6f73"/>
    <rect x="18" y="16" width="12" height="9" rx="2" fill="#ffbd66"/>
    <rect x="4" y="13" width="18" height="30" rx="6" fill="#54a6a4"/><rect x="26" y="13" width="18" height="30" rx="6" fill="#54a6a4"/>
    <path d="M4 22 H22 M26 22 H44" fill="none" stroke-width="1.6"/>
    <circle cx="13" cy="33" r="6.5" fill="#bdeef0"/><circle cx="35" cy="33" r="6.5" fill="#bdeef0"/></g>
    <g fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><path d="M10 31 C10.5 29.5 11.5 28.8 13 28.5"/><path d="M32 31 C32.5 29.5 33.5 28.8 35 28.5"/></g>
    <path d="M7 16 V21 M29 16 V21" stroke="#9fd6d0" stroke-width="1.5" stroke-linecap="round"/>`,

  // [camera] Little Camera, Photo Frame
  camera: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M10 14 C12 6 18 4 24 4 C30 4 36 6 38 14" fill="none" stroke="#c9a46a" stroke-width="2.4"/>
    <rect x="4" y="14" width="40" height="27" rx="5" fill="#fff2cc"/>
    <path d="M4 21 V19 C4 16 6 14 9 14 H39 C42 14 44 16 44 19 V21 Z" fill="#e07a5f"/>
    <rect x="30" y="9" width="8" height="5" rx="1.5" fill="#e07a5f"/>
    <rect x="8" y="23" width="7" height="5" rx="1" fill="#ffffff"/>
    <circle cx="26" cy="29" r="9" fill="#2b3a40"/><circle cx="26" cy="29" r="5.5" fill="#bfe6ef"/></g>
    <path d="M23.5 26.8 C24.3 25.8 25.4 25.3 26.6 25.3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`,
  photoframe: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M14 40 L10 46 M34 40 L38 46" fill="none" stroke-width="2.4"/>
    <rect x="3" y="6" width="42" height="34" rx="3" fill="#c99560"/>
    <rect x="9" y="12" width="30" height="22" fill="#9fd6e8"/>
    <path d="M9 26 H39 V34 H9 Z" fill="#54a6a4"/></g>
    <circle cx="32" cy="20" r="3.5" fill="#ffbd66"/>
    <path d="M14 19 Q16.5 16.5 19 19 Q21.5 16.5 24 19" fill="none" stroke="#153e49" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M12 30 Q16 28.5 20 30 M26 31 Q30 29.5 35 31" fill="none" stroke="#d9f2f2" stroke-width="1.3" stroke-linecap="round"/>`,
  spyglass: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" transform="rotate(-38 24 24)">
    <rect x="3" y="20.5" width="5" height="7" rx="1.5" fill="#8a6a32"/>
    <rect x="7" y="19.5" width="11" height="9" rx="2" fill="#c9a15a"/>
    <path d="M17 17.5 H36 V30.5 H17 Z" fill="#6b4529"/>
    <rect x="15" y="16.5" width="4" height="15" rx="1.5" fill="#c9a15a"/><rect x="25" y="16.5" width="3.5" height="15" rx="1.5" fill="#c9a15a"/>
    <path d="M35 16.5 L44 14 V34 L35 31.5 Z" fill="#c9a15a"/>
    <path d="M20 21 H33" fill="none" stroke="#9a6b44" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M44 16.5 V31.5" fill="none" stroke="#cfe8ea" stroke-width="2.4" stroke-linecap="round"/></g>`, // [spyglass]

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

  // [power] wind turbine, battery, string lights, lamp post
  turbine: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M22 44 L23 17 H25 L26 44 Z" fill="#b9c2c9"/>
    <rect x="15" y="40" width="18" height="4" rx="1.5" fill="#8d979e"/>
    <path d="M24 15 L21.5 3 C23 2 25 2 26.5 3 Z" fill="#f4f1ea"/>
    <path d="M24 15 L35 21 C35 23 34 24.5 32.5 25 Z" fill="#f4f1ea"/>
    <path d="M24 15 L13 21 C13 23 14 24.5 15.5 25 Z" fill="#f4f1ea"/>
    <circle cx="24" cy="15" r="3.2" fill="#e07a5f"/></g>
    <path d="M38 8 C41 7 43 9 45 8 M37 13 C40 12 42 14 44 13" fill="none" stroke="#9fd6d0" stroke-width="1.6" stroke-linecap="round"/>`, // [power]

  battery: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <rect x="13" y="7" width="6" height="5" rx="1" fill="#d9483b"/>
    <rect x="29" y="7" width="6" height="5" rx="1" fill="#2b2b2b"/>
    <rect x="6" y="12" width="36" height="30" rx="3" fill="#4a5a6a"/>
    <rect x="6" y="12" width="36" height="5" rx="2" fill="#36424e"/>
    <path d="M26 20 L18 31 H24 L21 39 L30 27 H24 Z" fill="#f2c14e" stroke-width="1.6"/></g>
    <path d="M10 22 V36" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-opacity=".5"/>`, // [power]

  stringlights: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M7 44 V8" fill="none" stroke="#906f48" stroke-width="3.2"/>
    <path d="M41 44 V24" fill="none" stroke="#906f48" stroke-width="2.6"/>
    <path d="M7 9 C16 26 30 28 41 24" fill="none" stroke="#2b2b2b" stroke-width="1.6"/>
    <g stroke-width="1.4"><circle cx="13" cy="20" r="3" fill="#ffd27a"/><circle cx="20" cy="26" r="3" fill="#ffb35a"/><circle cx="28" cy="28.5" r="3" fill="#fff1c4"/><circle cx="35" cy="27.5" r="3" fill="#ffd27a"/></g></g>
    <g fill="#ffe8b0" fill-opacity=".45"><circle cx="13" cy="20" r="5.5"/><circle cx="28" cy="28.5" r="5.5"/></g>`, // [power]

  lamppost: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M22.5 44 V18 H25.5 V44 Z" fill="#5d6b78"/>
    <rect x="16" y="41" width="16" height="4" rx="1.5" fill="#4c5864"/>
    <path d="M25.5 30 C30 30 31 27 31 25" fill="none" stroke="#4c5864" stroke-width="1.8"/>
    <rect x="17" y="9" width="14" height="10" rx="1" fill="#ffe2a8"/>
    <path d="M14 9 L24 3 L34 9 Z" fill="#4c5864"/></g>
    <circle cx="24" cy="14" r="2.6" fill="#fff6dc"/>
    <path d="M10 15 H5 M38 15 H43 M12 22 L8 25 M36 22 L40 25" stroke="#ffd27a" stroke-width="1.6" stroke-linecap="round"/>`, // [power]

  // [tasks] Task Board
  taskboard: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M11 30 V45 M37 30 V45" fill="none" stroke="#9c7649" stroke-width="3.2"/>
    <rect x="5" y="9" width="38" height="25" rx="2" fill="#bb8650"/>
    <rect x="8.5" y="12.5" width="31" height="18" rx="1" fill="#c9a26b" stroke-width="1.4"/>
    <path d="M3 8.5 H45" stroke-width="3.4"/>
    <g fill="#fff2cc" stroke-width="1.3"><path d="M11 15 L20 14 L21 27 L12 28 Z"/><path d="M22.5 14.5 H30 V27.5 H22.5 Z"/><path d="M31 14 L37.5 15 L36.5 27 L30.5 26 Z"/></g></g>
    <g fill="#d9573f" stroke="${O}" stroke-width=".9"><circle cx="15.5" cy="15.5" r="1.6"/><circle cx="26.2" cy="15.6" r="1.6"/><circle cx="34.3" cy="16" r="1.6"/></g>
    <path d="M13.5 20 H18.5 M13.8 23.5 H18 M24 20 H28.5 M24 23.5 H27.5 M32.5 20.5 H35.5" stroke="${O}" stroke-width="1" stroke-opacity=".5" stroke-linecap="round"/>`,

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

  // [juicer] island berries (the coconut icon is the [axe] one above), three smoothie cups with a straw, the juicer
  berries: `<path d="M24 14 C22 9 18 7 14 7 M24 14 C27 9 32 8 35 9" fill="none" stroke="#3f7a3a" stroke-width="2" stroke-linecap="round"/>
    <path d="M24 13 C29 9 35 11 36 15 C31 17 27 16 24 13 Z" fill="#5fae6b" stroke="${O}" stroke-width="1.6" stroke-linejoin="round"/>
    <g stroke="${O}" stroke-width="2" fill="#c2335a"><circle cx="17" cy="24" r="6"/><circle cx="30" cy="23" r="6"/><circle cx="23" cy="33" r="6.5"/><circle cx="33" cy="35" r="5.5"/><circle cx="13" cy="36" r="5"/></g>
    <g fill="#ff9fb8"><circle cx="15" cy="22" r="1.6"/><circle cx="28" cy="21" r="1.6"/><circle cx="21" cy="31" r="1.7"/><circle cx="31" cy="33" r="1.4"/><circle cx="11.5" cy="34.5" r="1.3"/></g>`,


  berrycup: `<path d="M29 4 L26 22" fill="none" stroke="${O}" stroke-width="4.5" stroke-linecap="round"/><path d="M29 4 L26 22" fill="none" stroke="#ff7aa2" stroke-width="2.4" stroke-linecap="round"/>
    <g stroke="${O}" stroke-width="2" stroke-linejoin="round"><path d="M11 16 H37 L34 43 H14 Z" fill="#cfeef0"/><path d="M12.2 22 H35.8 L33.6 41 H14.4 Z" fill="#c2335a" stroke="none"/><path d="M10 16 H38" fill="none"/></g>
    <path d="M16 25 V37" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-opacity=".6"/>`,

  coconutcup: `<path d="M29 4 L26 22" fill="none" stroke="${O}" stroke-width="4.5" stroke-linecap="round"/><path d="M29 4 L26 22" fill="none" stroke="#54a6a4" stroke-width="2.4" stroke-linecap="round"/>
    <g stroke="${O}" stroke-width="2" stroke-linejoin="round"><path d="M11 16 H37 L34 43 H14 Z" fill="#cfeef0"/><path d="M12.2 22 H35.8 L33.6 41 H14.4 Z" fill="#f1e8d6" stroke="none"/><path d="M10 16 H38" fill="none"/></g>
    <path d="M16 25 V37" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-opacity=".8"/><circle cx="30" cy="28" r="1.4" fill="#b99a74"/>`,

  mixcup: `<path d="M29 4 L26 22" fill="none" stroke="${O}" stroke-width="4.5" stroke-linecap="round"/><path d="M29 4 L26 22" fill="none" stroke="#ffbd66" stroke-width="2.4" stroke-linecap="round"/>
    <g stroke="${O}" stroke-width="2" stroke-linejoin="round"><path d="M11 16 H37 L34 43 H14 Z" fill="#cfeef0"/><path d="M12.2 22 H35.8 L33.6 41 H14.4 Z" fill="#e9835f" stroke="none"/><path d="M10 16 H38" fill="none"/></g>
    <path d="M16 25 V37" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-opacity=".6"/><circle cx="20" cy="18" r="3" fill="#c2335a" stroke="${O}" stroke-width="1.4"/>`,

  juicer: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M9 44 V36 M39 44 V36" fill="none"/><rect x="6" y="33" width="36" height="4" rx="1" fill="#9c7649"/>
    <path d="M14 6 H34 L28 14 H20 Z" fill="#8d97a3"/>
    <rect x="16" y="14" width="16" height="13" rx="2" fill="#a9b4c2"/>
    <path d="M32 19 H38 V12" fill="none" stroke="#5d6b78" stroke-width="2.4"/><circle cx="38" cy="10" r="2.6" fill="#c69860"/>
    <path d="M22 27 V29 H26 V27" fill="#8d97a3"/>
    <path d="M18 29 H30 V33 H18 Z" fill="#cfeef0"/><path d="M19 30.5 H29 V33 H19 Z" fill="#e9835f" stroke="none"/></g>`,

  // [gull] gull perch: T-shaped driftwood post, woven tray, a gull on top
  perch: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <ellipse cx="24" cy="43" rx="10" ry="2.6" fill="#7a5a36"/>
    <path d="M22.5 42 L23 17 H26 L25.5 42 Z" fill="#a88457"/>
    <rect x="13" y="15" width="22" height="4" rx="2" fill="#b89466"/>
    <path d="M25 30 H33" fill="none" stroke-width="2.2"/>
    <path d="M29 28 H43 L41 34 H31 Z" fill="#c9a46a"/>
    <path d="M28.5 28 H43.5" fill="none" stroke="#8e6c3e" stroke-width="2.4"/>
    <path d="M17 15 C15 10 18 6 23 6 C27 6 29 8 30 10 L34 10 L30 12.5 C29 15 26 15.5 24 15.5 Z" fill="#f6f6f1"/>
    <path d="M18 11 C21 8.5 25 9 28 12" fill="#a9b3bc" stroke-width="1.4"/></g>
    <circle cx="27.5" cy="8.5" r="1.1" fill="${O}"/>
    <path d="M31 9.8 L34.5 10 L31 11.3 Z" fill="#f39a24" stroke="none"/>
    <path d="M32 31 L36 31 M37 31 L40 31" stroke="#8e6c3e" stroke-width="1.1" stroke-linecap="round"/>`,
  // [display] display shelf with three little finds, trophy stand with a fish and a brass plaque
  shelf: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <rect x="13" y="13" width="9" height="11" rx="1.5" fill="#9fd6d0"/>
    <path d="M26 24 L30 13 L34 24 Z" fill="#f2b134"/>
    <circle cx="39" cy="19.5" r="4.5" fill="#d98a6a"/>
    <path d="M6 10 V44 M42 10 V44" fill="none" stroke="#906f48" stroke-width="4"/>
    <path d="M6 10 V44 M42 10 V44" fill="none" stroke-width="1"/>
    <rect x="4" y="24" width="40" height="5" rx="1" fill="#b4824b"/>
    <rect x="4" y="38" width="40" height="5" rx="1" fill="#b4824b"/></g>
    <path d="M8 26 H40" stroke="#e8c08a" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M15 15 V21" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-opacity=".8"/>`, // [display]

  trophystand: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M24 17 V21" fill="none" stroke-width="2.4"/>
    <path d="M9 11 C14 4 27 4 32 10 L39 5 V17 L32 12 C27 18 14 18 9 11 Z" fill="#54a6a4"/>
    <rect x="12" y="21" width="24" height="5" rx="1" fill="#6e4f33"/>
    <rect x="14" y="26" width="20" height="14" fill="#b4824b"/>
    <rect x="11" y="40" width="26" height="5" rx="1" fill="#7d5c37"/>
    <rect x="18" y="30" width="12" height="5" rx="1" fill="#c9a24a" stroke-width="1.4"/></g>
    <circle cx="13" cy="10" r="1.2" fill="${O}"/>
    <path d="M15 8 C18 6.5 21 6.5 24 7" fill="none" stroke="#c8f0ea" stroke-width="1.4" stroke-linecap="round"/>`, // [display]

  // [fishtrap] woven basket with a crosshatch, a funnel mouth, a rope loop and a little fish tail at the mouth
  fishtrap: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M24 3 C20 3 19 8 24 9 C29 8 28 3 24 3 Z" fill="none" stroke="#d8c39a" stroke-width="2.2"/>
    <path d="M24 9 V14" fill="none" stroke="#d8c39a" stroke-width="2.2"/>
    <path d="M9 17 C9 15 39 15 39 17 L36 40 C35 44 13 44 12 40 Z" fill="#b98a4e"/></g>
    <g fill="none" stroke="#7a5530" stroke-width="1.3" stroke-linecap="round">
      <path d="M12 22 L30 41 M11 30 L22 42 M17 17 L37 37 M25 17 L38 29 M33 17 L38.5 22"/>
      <path d="M36 22 L18 41 M37 30 L26 42 M31 17 L11 37 M23 17 L10 29 M15 17 L9.5 22"/></g>
    <path d="M10 22 H38 M11 30 H37" fill="none" stroke="#93683a" stroke-width="1.6"/>
    <g stroke="${O}" stroke-width="2" stroke-linejoin="round">
      <ellipse cx="24" cy="17" rx="15" ry="4" fill="#93683a"/>
      <ellipse cx="24" cy="17.4" rx="6" ry="1.9" fill="#3b2a1a" stroke-width="1.4"/>
      <path d="M27 17 L33 11 L35 16 L31 18 Z" fill="#54a6a4" stroke-width="1.5"/></g>
    <path d="M13 34 C13 37 14 39 16 40" fill="none" stroke="#fff2cc" stroke-width="1.6" stroke-linecap="round" stroke-opacity=".8"/>`,

  // [recycler] floating junk + Sorting Tub
  oldboot: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M13 8 H27 L28 26 C34 27 41 29 43 34 V39 H7 V31 C9 25 11 18 13 8 Z" fill="#8a6242"/>
    <path d="M12 12 H28" fill="none" stroke-width="1.6"/>
    <path d="M6 39 H44 V42 C44 43 43 44 42 44 H8 C7 44 6 43 6 42 Z" fill="#3a4547"/>
    <path d="M31 29 C36 30 40 31 42 35" fill="none" stroke="#b08458" stroke-width="1.8"/></g>
    <g fill="none" stroke="#fff2cc" stroke-width="1.7" stroke-linecap="round"><path d="M21 16 L26 18"/><path d="M21 21 L26 23"/><path d="M22 26 L27 27"/></g>
    <path d="M18 8 C17 4 20 2 23 3 C21 5 21 7 22 8" fill="#5fae6b" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>`,

  tincan: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M8 16 H34 V36 H8 Z" fill="#9fb1bf"/>
    <path d="M8 21 H34 V31 H8 Z" fill="#9fd6d0"/>
    <path d="M8 25.5 H34" stroke="#54a6a4" stroke-width="1.4"/>
    <ellipse cx="34" cy="26" rx="6" ry="10" fill="#c6d6e0"/>
    <ellipse cx="34" cy="26" rx="3.4" ry="6.6" fill="none" stroke-width="1.2" stroke-opacity=".6"/>
    <path d="M14 21 L18 16.8 L20 21 Z" fill="#fff2cc" stroke-width="1.4"/>
    <path d="M24 31 C23 33.5 25 35 27 36" fill="none" stroke-width="1.3" stroke-opacity=".6"/></g>
    <path d="M10.5 18.5 H30" stroke="#fff2cc" stroke-width="1.6" stroke-linecap="round" stroke-opacity=".8"/>`,

  seajar: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M17 12 H31 V15 C37 17 39 21 39 26 V38 C39 41 37 43 34 43 H14 C11 43 9 41 9 38 V26 C9 21 11 17 17 15 Z" fill="#9fd0c8"/>
    <path d="M16 5 H32 V12 H16 Z" fill="#c99560"/>
    <path d="M15 12.5 H33" stroke="#d9c38c" stroke-width="2.4"/></g>
    <path d="M14 24 C14 21 16 19 19 18.4 M13.6 28 V36" fill="none" stroke="#e8f7f3" stroke-width="2" stroke-linecap="round"/>
    <g fill="#e8f7f3"><circle cx="27" cy="30" r="1.3"/><circle cx="32" cy="36" r="1"/><circle cx="23" cy="37" r="1.1"/><circle cx="33" cy="24" r=".9"/></g>`,

  recycler: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M6 18 H38 L35 42 H9 Z" fill="#bb8650"/>
    <path d="M14 18 L15 42 M22 18 V42 M30 18 L29 42" fill="none" stroke-width="1.2" stroke-opacity=".55"/>
    <path d="M6.6 24 H37.4 M8.4 36 H35.6" fill="none" stroke="#d9c38c" stroke-width="2.6"/>
    <ellipse cx="22" cy="18" rx="16" ry="4" fill="#5d4129"/>
    <rect x="9" y="9" width="7" height="8" rx="1" fill="#a9542a"/><rect x="18.5" y="8" width="7" height="9" rx="1" fill="#54a6a4"/><rect x="28" y="9" width="7" height="8" rx="1" fill="#e9b85a"/>
    <path d="M38 27 H42 V17" fill="none" stroke-width="2.4"/>
    <circle cx="42" cy="15" r="2.6" fill="#e8792e"/></g>`,

  // [fireworks] sky rocket: striped coral tube, cone cap, stick stand and a little four-point star
  skyrocket: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M30 22 L27 45 M24 38 L18 45 M24 38 L30 45" fill="none" stroke="#9c7649" stroke-width="2.2"/>
    <rect x="17" y="17" width="10" height="21" rx="1.5" fill="#fff3cf"/>
    <path d="M17 24 H27 V31 H17 Z" fill="#e9a08c"/><path d="M17 17 H27 V20 H17 Z" fill="#e9a08c"/>
    <path d="M15.5 17 L22 6 L28.5 17 Z" fill="#f1d78d"/>
    <path d="M22 38 C21 41 19.5 42 18 42" fill="none" stroke-width="1.5"/></g>
    <path d="M19.5 21 V36" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-opacity=".8"/>
    <path d="M38 6 L39.4 10.6 L44 12 L39.4 13.4 L38 18 L36.6 13.4 L32 12 L36.6 10.6 Z" fill="#ffe08a" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>`,

  // [scarecrow] driftwood post, crossbar with rags, leaf skirt, sack head and a bucket hat
  scarecrow: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M22.5 18 H25.5 V44 H22.5 Z" fill="#cdbb9a"/>
    <path d="M14 44 H34" fill="none" stroke="#9e8e73" stroke-width="3"/>
    <rect x="7" y="22" width="34" height="3.4" rx="1.2" fill="#cdbb9a"/>
    <path d="M9 25 L7.5 32 L11 31 Z" fill="#8fb8d8" stroke-width="1.4"/><path d="M39 25 L40.5 32 L37 31 Z" fill="#e8d6a8" stroke-width="1.4"/>
    <path d="M17 27 H31 L34 38 L29 36 L27 39 L24 36 L21 39 L19 36 L14 38 Z" fill="#6fae4f"/>
    <circle cx="24" cy="14.5" r="5.5" fill="#d8c08e"/>
    <path d="M13 10 H35 C34 11.8 14 11.8 13 10 Z" fill="#e07a4f"/>
    <path d="M18 10 C18 5 20 3.5 24 3.5 C28 3.5 30 5 30 10 Z" fill="#e07a4f"/></g>
    <g fill="${O}"><circle cx="22" cy="14" r=".9"/><circle cx="26" cy="14" r=".9"/></g>
    <path d="M21.5 16.8 C23 18.3 25 18.3 26.5 16.8" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-dasharray=".1 1.3"/>`,

  // [zipline] glide post (mast + wheel), low glide post, glide handle (T-bar with a wheel)
  glidepost: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <rect x="14" y="40" width="20" height="4" rx="1" fill="#8b6a43"/>
    <path d="M22 41 L22.8 11 H25.2 L26 41 Z" fill="#bb8650"/>
    <path d="M18 40 L23 30 M30 40 L25 30" fill="none" stroke="#8b6a43"/>
    <rect x="21.5" y="24" width="5" height="3" rx="1" fill="#c9a66b"/>
    <ellipse cx="24" cy="8" rx="8" ry="3.5" fill="#6b5a4c"/><ellipse cx="24" cy="7.5" rx="3" ry="1.4" fill="#c9a66b"/></g>
    <path d="M2 9 C10 8 15 8 16 8" fill="none" stroke="#c9a66b" stroke-width="1.6" stroke-linecap="round"/>`,
  glidestep: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <rect x="12" y="39" width="24" height="5" rx="1" fill="#8b6a43"/>
    <path d="M19.5 40 L21 27 H27 L28.5 40 Z" fill="#c99560"/>
    <rect x="20" y="32" width="8" height="3" rx="1" fill="#c9a66b"/>
    <ellipse cx="24" cy="24" rx="9" ry="4" fill="#2fa39a"/><ellipse cx="24" cy="23.5" rx="3.2" ry="1.5" fill="#c9a66b"/></g>
    <path d="M2 8 C9 12 13 18 15 23" fill="none" stroke="#c9a66b" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M38 4 V15 M33.5 11 L38 15.5 L42.5 11" fill="none" stroke="${O}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M38 4 V15 M33.5 11 L38 15.5 L42.5 11" fill="none" stroke="#2fa39a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  glidehandle: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <circle cx="24" cy="10" r="6" fill="#6b5a4c"/><circle cx="24" cy="10" r="2" fill="#c9a66b"/>
    <rect x="22" y="15" width="4" height="16" rx="1" fill="#c9a66b"/>
    <rect x="6" y="30" width="36" height="6" rx="3" fill="#bb8650"/>
    <rect x="8" y="29.5" width="4" height="7" rx="1" fill="#c9a66b"/><rect x="36" y="29.5" width="4" height="7" rx="1" fill="#c9a66b"/></g>
    <path d="M2 10 H46" fill="none" stroke="#c9a66b" stroke-width="1.4" stroke-opacity=".7"/>`,

  seaweed: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round">
    <path d="M16 44 C8 36 18 29 12 21 C8 15 11 9 14 4 C23 9 21 16 25 22 C29 30 22 36 24 44 Z" fill="#3f8f5a"/>
    <path d="M25 44 C21 35 30 30 27 20 C26 14 30 9 36 7 C39 15 35 19 37 25 C39 33 32 37 33 44 Z" fill="#5fae6b"/>
    <path d="M8 44 C6 38 10 35 8 29 C11 31 14 35 13 39 C13 41 14 43 15 44 Z" fill="#7cc47f"/>
    <path d="M2 44 H46" fill="none"/></g>
    <g fill="none" stroke="${O}" stroke-width="1.1" stroke-opacity=".55" stroke-linecap="round"><path d="M16 9 C18 16 16 24 20 33"/><path d="M32 12 C31 20 32 28 28 38"/></g>
    <g fill="#bdeef0" stroke="${O}" stroke-width="1.2"><circle cx="40" cy="16" r="2.6"/><circle cx="42" cy="26" r="1.6"/><circle cx="8" cy="15" r="1.8"/></g>`,

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
  flagpole: `<g stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M13 6 C20 4 26 8 33 6 C36 5.4 38.5 5.6 40 6 V24 C38.5 23.6 36 23.4 33 24 C26 26 20 22 13 24 Z" fill="#f1c84d"/>
    <path d="M26.5 10.5 C22 10.5 19.5 14 20 17.5 C20.5 20 23 21 26.5 21 C30 21 32.5 20 33 17.5 C33.5 14 31 10.5 26.5 10.5 Z" fill="#24456b" stroke-width="1.3"/>
    <path d="M10.5 44 V5 H13.5 V44 Z" fill="#8a6a45"/>
    <path d="M7 44 H17" fill="none"/>
    <circle cx="12" cy="4" r="2.4" fill="#ffbd66"/></g>
    <g fill="none" stroke="#f1c84d" stroke-width="1.1" stroke-linecap="round"><path d="M26.5 12 V20"/><path d="M23 13.5 L24.8 20"/><path d="M30 13.5 L28.2 20"/></g>
    <path d="M16 9 C20 7.5 24 9 28 8.6" fill="none" stroke="#fff2cc" stroke-width="1.5" stroke-linecap="round"/>`, // [flags]
});
