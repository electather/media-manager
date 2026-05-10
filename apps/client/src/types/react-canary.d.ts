// Module augmentation for React canary additions that aren't yet in the
// stable `@types/react` (19.2.x) we have installed. Add types here without
// upgrading the package.

import "react";

declare module "react" {
  interface ViewTransitionClassMap {
    readonly [type: string]: string | undefined;
    readonly default: string;
  }

  type ViewTransitionClass = string | ViewTransitionClassMap;

  interface ViewTransitionProps {
    name?: string;
    enter?: ViewTransitionClass;
    exit?: ViewTransitionClass;
    share?: ViewTransitionClass;
    update?: ViewTransitionClass;
    default?: ViewTransitionClass;
    children?: ReactNode;
  }

  const ViewTransition: FC<ViewTransitionProps>;

  function addTransitionType(type: string): void;
}
