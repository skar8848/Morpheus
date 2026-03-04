import Navbar from "@/components/layout/Navbar";
import { ChainProvider } from "@/lib/context/ChainContext";

export default function ChainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ChainProvider>
      <div className="min-h-screen bg-bg-primary">
        <Navbar />
        {children}
      </div>
    </ChainProvider>
  );
}
