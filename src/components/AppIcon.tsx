import type { SVGProps } from 'react';
import { APP_ICON_COLOR, APP_ICON_PATH, APP_ICON_VIEW_BOX } from '@/lib/app-icon';

/** Shared brand mark: Material Symbols Outlined / lyrics, with no background. */
export default function AppIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox={APP_ICON_VIEW_BOX}
      fill={APP_ICON_COLOR} aria-hidden="true" focusable="false" {...props}>
      <path d={APP_ICON_PATH} />
    </svg>
  );
}
