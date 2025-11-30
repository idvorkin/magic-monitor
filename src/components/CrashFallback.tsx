import {
	buildCrashReportBody,
	buildGitHubIssueUrl,
	getMetadata,
} from "../utils/bugReportFormatters";
import { GIT_COMMIT_URL, GIT_SHA_SHORT } from "../version";

const GITHUB_REPO_URL = "https://github.com/idvorkin/magic-monitor";

export function CrashFallback({ error }: { error: Error }) {
	const metadata = getMetadata(
		() => window.location.pathname,
		() => navigator.userAgent,
	);
	const reportUrl = buildGitHubIssueUrl(
		GITHUB_REPO_URL,
		`Crash: ${error.message.slice(0, 50)}`,
		buildCrashReportBody(error, metadata),
		["bug", "crash"],
	);

	return (
		<div className="w-screen h-screen bg-gray-900 flex items-center justify-center p-8 overflow-auto">
			<div className="max-w-2xl text-center">
				<h1 className="text-2xl font-bold text-red-400 mb-4">
					Something went wrong
				</h1>
				<p className="text-gray-300 mb-4">{error.message}</p>
				{error.stack && (
					<pre className="text-left text-xs text-gray-400 bg-gray-800 p-4 rounded mb-4 overflow-auto max-h-64">
						{error.stack}
					</pre>
				)}
				<div className="flex gap-3 justify-center">
					<button
						onClick={() => window.location.reload()}
						className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
					>
						Reload Page
					</button>
					<a
						href={reportUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
					>
						Report on GitHub
					</a>
				</div>
				<p className="mt-4 text-sm text-gray-500">
					Build:{" "}
					<a
						href={GIT_COMMIT_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="text-blue-400 hover:underline"
					>
						{GIT_SHA_SHORT}
					</a>
				</p>
			</div>
		</div>
	);
}
