import clsx from "clsx";

type ToggleColor = "blue" | "green" | "purple" | "orange" | "yellow" | "red";

interface ToggleSwitchProps {
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
	color?: ToggleColor;
	size?: "sm" | "md";
}

const colorClasses: Record<ToggleColor, string> = {
	blue: "bg-blue-600",
	green: "bg-green-600",
	purple: "bg-purple-600",
	orange: "bg-orange-600",
	yellow: "bg-yellow-600",
	red: "bg-red-600",
};

export function ToggleSwitch({
	checked,
	onChange,
	disabled = false,
	color = "blue",
	size = "md",
}: ToggleSwitchProps) {
	const isMd = size === "md";

	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className={clsx(
				"rounded-full transition-colors relative",
				isMd ? "w-12 h-6" : "w-10 h-5",
				checked ? colorClasses[color] : "bg-gray-700",
				disabled && "opacity-50 cursor-not-allowed",
			)}
		>
			<div
				className={clsx(
					"absolute rounded-full bg-white transition-transform",
					isMd ? "top-1 w-4 h-4" : "top-0.5 w-4 h-4",
					checked ? (isMd ? "left-7" : "left-5") : (isMd ? "left-1" : "left-0.5"),
				)}
			/>
		</button>
	);
}
