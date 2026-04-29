import { Component, type ReactNode } from "react";

interface Props {
  rowTitle: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class RowErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          {this.props.rowTitle} couldn&apos;t render.
        </p>
      );
    }
    return this.props.children;
  }
}
