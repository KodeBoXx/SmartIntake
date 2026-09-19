import { Component, computed, input } from '@angular/core';

/**
 * Tones for taxonomic / identity chips (asset type, vendor type, category,
 * legal basis, etc.). Distinct from `CuiBadgeVariant`, which carries semantic
 * status (success/warning/error/info/neutral). Use cui-tag for "what kind",
 * cui-badge for "what state".
 */
export type CuiTagTone =
  | 'emerald'
  | 'lime'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'pink'
  | 'amber'
  | 'stone';

export type CuiTagSize = 'sm' | 'md';

@Component({
  selector: 'cui-tag',
  templateUrl: './tag.component.html',
  host: {
    class: 'inline-block',
  },
})
export class CuiTagComponent {
  readonly tone = input<CuiTagTone>('stone');
  readonly size = input<CuiTagSize>('md');

  readonly tagClasses = computed(() => {
    const classes: string[] = [
      'inline-flex items-center gap-1',
      'rounded-full',
      'type-caption-bold',
      'whitespace-nowrap',
    ];

    classes.push(this.size() === 'sm' ? 'px-2 py-[2px]' : 'px-2.5 py-[3px]');

    switch (this.tone()) {
      case 'emerald':
        classes.push('bg-emerald-50 text-emerald-700');
        break;
      case 'lime':
        classes.push('bg-lime-50 text-lime-700');
        break;
      case 'teal':
        classes.push('bg-teal-50 text-teal-700');
        break;
      case 'cyan':
        classes.push('bg-cyan-50 text-cyan-700');
        break;
      case 'sky':
        classes.push('bg-sky-50 text-sky-700');
        break;
      case 'blue':
        classes.push('bg-blue-50 text-blue-700');
        break;
      case 'indigo':
        classes.push('bg-indigo-50 text-indigo-700');
        break;
      case 'violet':
        classes.push('bg-violet-50 text-violet-700');
        break;
      case 'pink':
        classes.push('bg-pink-50 text-pink-700');
        break;
      case 'amber':
        classes.push('bg-amber-50 text-amber-800');
        break;
      case 'stone':
        classes.push('bg-stone-100 text-stone-700');
        break;
    }

    return classes.join(' ');
  });
}
