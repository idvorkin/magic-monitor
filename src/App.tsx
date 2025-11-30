import { ErrorBoundary } from "react-error-boundary";
import { CameraStage } from "./components/CameraStage";
import { CrashFallback } from "./components/CrashFallback";
import { VersionNotification } from "./components/VersionNotification";

function App() {
	return (
		<ErrorBoundary FallbackComponent={CrashFallback}>
			<div className="w-screen h-screen bg-gray-900 overflow-hidden">
				<CameraStage />
				<VersionNotification />
			</div>
		</ErrorBoundary>
	);
}

export default App;
