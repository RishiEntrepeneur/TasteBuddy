import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RestaurantDashboard } from "@/components/RestaurantDashboard";
import { getMenuItems, getRestaurant } from "@/lib/db/repository";

/**
 * The diner's dashboard — what the QR code on the table opens.
 *
 * Server-rendered so the menu is on screen before any JavaScript has loaded;
 * the interactive layer (allergen profile, portion sliders, AR) hydrates on
 * top. The allergen profile deliberately never reaches this component: it
 * lives in `localStorage` and is applied client-side, so no diner's health data
 * is sent to the server to render a menu.
 */

interface RestaurantPageProps {
  // Next 16 delivers route params asynchronously.
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: RestaurantPageProps): Promise<Metadata> {
  const { id } = await params;
  const restaurant = await getRestaurant(id);

  if (!restaurant) return { title: "Restaurant not found" };

  return {
    title: restaurant.name,
    description: `${restaurant.tagline} — see every dish in AR, sized to your portion and checked against your allergies.`,
    openGraph: {
      title: `${restaurant.name} · TasteBuddy`,
      description: restaurant.tagline,
    },
  };
}

export default async function RestaurantPage({ params }: RestaurantPageProps) {
  const { id } = await params;

  const restaurant = await getRestaurant(id);
  if (!restaurant) notFound();

  const items = await getMenuItems(restaurant.id);

  return <RestaurantDashboard restaurant={restaurant} items={items} />;
}
