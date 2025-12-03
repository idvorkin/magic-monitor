import { useEffect, useState } from "react";
import { useVersionCheck } from "../hooks/useVersionCheck";

// Delay before showing notification to avoid interrupting users on page load
const NOTIFICATION_DELAY_MS = 5000;

export function VersionNotification() {
	const { updateAvailable, reload } = useVersionCheck();
	const [dismissed, setDismissed] = useState(false);
	const [showNotification, setShowNotification] = useState(false);

	// Delay showing notification to avoid interrupting users mid-task
	useEffect(() => {
		if (!updateAvailable) {
			// eslint-disable-next-line react-hooks/set-state-in-effect -- Syncing with updateAvailable prop change
			setShowNotification(false);
			return;
		}

		const timer = setTimeout(() => {
			setShowNotification(true);
		}, NOTIFICATION_DELAY_MS);

		return () => clearTimeout(timer);
	}, [updateAvailable]);

	if (!showNotification || dismissed) return null;

	return (
		<div
			role="alert"
			aria-live="polite"
			aria-label="Application update available"
			className="fixed bottom-4 right-4 z-[70] animate-pulse"
		>
			<div className="bg-blue-600 border border-blue-400/30 p-4 rounded-xl shadow-2xl max-w-sm">
				<div className="flex items-center gap-3">
					<div className="text-2xl" aria-hidden="true">
						🚀
					</div>
					<div className="flex-1">
						<div className="text-white font-semibold">
							New Version Available
						</div>
						<div className="text-blue-200 text-sm">
							Reload to get the latest features
						</div>
					</div>
					<button
						onClick={reload}
						className="bg-white text-blue-600 px-4 py-2 rounded-lg font-bold hover:bg-blue-50 transition-colors"
					>
						Reload
					</button>
					<button
						onClick={() => setDismissed(true)}
						className="text-white/70 hover:text-white p-1 transition-colors"
						aria-label="Dismiss update notification"
					>
						<svg
							className="w-5 h-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>
				</div>
			</div>
		</div>
	);
}
