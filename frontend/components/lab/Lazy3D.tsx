import { lazy, Suspense, type ComponentProps } from "react";

// three.js is big: load the 3D view the first time one is shown, not with the main window.
const Circuit3DImpl = lazy(() => import("./Circuit3D").then((m) => ({ default: m.Circuit3D })));

export function Circuit3D(props: ComponentProps<typeof Circuit3DImpl>) {
  return (
    <Suspense fallback={<div className="c3d-wrap c3d-loading">loading 3D…</div>}>
      <Circuit3DImpl {...props} />
    </Suspense>
  );
}
