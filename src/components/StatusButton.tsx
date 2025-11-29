import clsx from "clsx";

type StatusColor = "blue" | "green" | "red" | "purple" | "orange";

interface StatusButtonProps {
	children: React.ReactNode;
	onClick: () => void;
	active?: boolean;
	disabled?: boolean;
	color?: StatusColor;
	title?: string;
	warning?: boolean;
}

const activeColorClasses: Record<StatusColor, string> = {
	blue: "bg-blue-600 text-white",
	green: "bg-green-600 text-white",
	red: "bg-red-600 text-white",
	purple: "bg-purple-600 text-white",
	orange: "bg-orange-600 text-white",
};

export function StatusButton({
	children,
	onClick,
	active = false,
	disabled = false,
	color = "blue",
	title,
	warning = false,
}: StatusButtonProps) {
	return (
		<button
			onClick={onClick}
			disabled={disabled}
			title={title}
			className={clsx(
				"px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
				active && activeColorClasses[color],
				!active && !warning && "bg-white/10 text-white/50 hover:bg-white/20 hover:text-white",
				!active && warning && "bg-orange-600/50 text-orange-200 hover:bg-orange-600/70",
				disabled && "cursor-wait",
			)}
		>
			{children}
		</button>
	);
}
