import { Directive, TemplateRef, inject } from '@angular/core';

@Directive({
  selector: '[cuiHeaderTabs]',
  standalone: true,
})
export class CuiHeaderTabsDirective {
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}

@Directive({
  selector: '[cuiHeaderIcons]',
  standalone: true,
})
export class CuiHeaderIconsDirective {
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}

@Directive({
  selector: '[cuiHeaderDrawer]',
  standalone: true,
})
export class CuiHeaderDrawerDirective {
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}
