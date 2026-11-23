import Link from "next/link";
import Image from "next/image";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="SignRelay home">
      <Image className="brand-mark" src="/signrelay-mark.webp" width={28} height={28} alt="" aria-hidden="true" unoptimized />
      <span className="brand-wordmark">SignRelay</span>
    </Link>
  );
}
