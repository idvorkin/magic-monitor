import { Bug, ExternalLink, GitBranch, GitCommit, Github } from "lucide-react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { sanitizeGitUrl } from "../utils/bugReportFormatters";
import {
	BUILD_TIMESTAMP,
	GIT_BRANCH,
	GIT_COMMIT_URL,
	GIT_CURRENT_URL,
	GIT_SHA_SHORT,
} from "../version";

interface AboutModalProps {
	isOpen: boolean;
	onClose: () => void;
	githubRepoUrl: string;
	onReportBug: () => void;
	bugReportShortcut: string;
}

export function AboutModal({
	isOpen,
	onClose,
	githubRepoUrl,
	onReportBug,
	bugReportShortcut,
}: AboutModalProps) {
	const containerRef = useFocusTrap({ isOpen, onClose });

	if (!isOpen) return null;

	const buildDate = new Date(BUILD_TIMESTAMP);
	const formattedDate = buildDate.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
	const formattedTime = buildDate.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
	});

	return (
		<div
			className="absolute inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				ref={containerRef}
				className="bg-gray-900 border border-white/10 p-6 rounded-2xl w-full max-w-sm shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex justify-between items-center mb-6">
					<h2 className="text-xl font-bold text-white">About</h2>
					<button onClick={onClose} className="text-white/50 hover:text-white">
						<svg
							className="w-6 h-6"
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

				<div className="space-y-4">
					{/* App Name */}
					<div className="text-center pb-4 border-b border-white/10">
						<h3 className="text-2xl font-bold text-white">Magic Monitor</h3>
						<p className="text-sm text-gray-400 mt-1">
							Real-time camera mirroring with smart features
						</p>
					</div>

					{/* Version Info */}
					<div className="space-y-3">
						{/* Commit */}
						<div className="flex items-center gap-3">
							<GitCommit className="w-4 h-4 text-gray-400" />
							<span className="text-sm text-gray-400 w-16">Commit</span>
							<a
								href={sanitizeGitUrl(GIT_COMMIT_URL)}
								target="_blank"
								rel="noopener noreferrer"
								className="text-sm text-blue-400 hover:text-blue-300 font-mono flex items-center gap-1"
							>
								{GIT_SHA_SHORT}
								<ExternalLink className="w-3 h-3" />
							</a>
						</div>

						{/* Branch */}
						<div className="flex items-center gap-3">
							<GitBranch className="w-4 h-4 text-gray-400" />
							<span className="text-sm text-gray-400 w-16">Branch</span>
							<a
								href={sanitizeGitUrl(GIT_CURRENT_URL)}
								target="_blank"
								rel="noopener noreferrer"
								className="text-sm text-blue-400 hover:text-blue-300 font-mono flex items-center gap-1"
							>
								{GIT_BRANCH}
								<ExternalLink className="w-3 h-3" />
							</a>
						</div>

						{/* Build Time */}
						<div className="flex items-center gap-3">
							<svg
								className="w-4 h-4 text-gray-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
							<span className="text-sm text-gray-400 w-16">Built</span>
							<span className="text-sm text-white">
								{formattedDate} at {formattedTime}
							</span>
						</div>
					</div>

					{/* GitHub Link */}
					<a
						href={githubRepoUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors"
					>
						<Github className="w-5 h-5 text-white" />
						<div className="flex-1">
							<div className="text-white text-sm font-medium">
								View on GitHub
							</div>
							<div className="text-xs text-gray-500">
								{githubRepoUrl.replace("https://", "")}
							</div>
						</div>
						<ExternalLink className="w-4 h-4 text-gray-500" />
					</a>

					{/* Report Bug */}
					<button
						onClick={() => {
							onReportBug();
							onClose();
						}}
						className="w-full flex items-center gap-3 p-3 bg-red-600/20 border border-red-500/30 rounded-lg text-red-300 hover:bg-red-600/30 transition-colors"
					>
						<Bug className="w-5 h-5" />
						<div className="flex-1 text-left">
							<div className="text-sm font-medium">Report a Bug</div>
							<div className="text-xs text-red-400/70">
								Help improve Magic Monitor
							</div>
						</div>
						<kbd className="px-1.5 py-0.5 bg-white/10 rounded text-xs text-red-400">
							{bugReportShortcut}
						</kbd>
					</button>
				</div>
			</div>
		</div>
	);
}
