import Navbar from "@/app/components/navbar";

export default function VenuesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-purple-50 to-pink-50 dark:from-gray-950 dark:to-purple-950">
      <Navbar />
      {children}
    </div>
  );
}
