import { useAppStore } from "../store/useAppStore";

function ScrollPercent() {
  const scrollPercent = useAppStore((state) => state.scrollPercent);
  return scrollPercent === null ? null : (
    <div className="scroll-percent">{`${scrollPercent}%`}</div>
  );
}

export default ScrollPercent;
