import { StatusButton } from "./StatusButton";

export interface SmartZoomToggleProps {
	isSmartZoom: boolean;
	onSmartZoomChange: (enabled: boolean) => void;
	isModelLoading: boolean;
	loadingProgress: number;
	loadingPhase: "downloading" | "initializing";
	modelError?: string | null;
}

/**
 * Toggle button for Smart Zoom feature with loading state display.
 * Shows download/initialization progress when model is loading, and a
 * failed state (with the error as the tooltip) if the model failed to load.
 */
export function SmartZoomToggle({
	isSmartZoom,
	onSmartZoomChange,
	isModelLoading,
	loadingProgress,
	loadingPhase,
	modelError,
}: SmartZoomToggleProps) {
	const hasFailed = !isModelLoading && !!modelError;

	const getButtonText = () => {
		if (isModelLoading) {
			return loadingPhase === "initializing"
				? "Initializing..."
				: `Downloading ${loadingProgress}%`;
		}
		if (hasFailed) {
			return "Smart \u26a0";
		}
		return isSmartZoom ? "Smart \u2713" : "Smart";
	};

	return (
		<StatusButton
			onClick={() => onSmartZoomChange(!isSmartZoom)}
			disabled={isModelLoading}
			active={isSmartZoom && !isModelLoading}
			warning={hasFailed}
			color="green"
			title={hasFailed ? (modelError ?? undefined) : "Smart Zoom - Auto-follow movement"}
		>
			{getButtonText()}
		</StatusButton>
	);
}
