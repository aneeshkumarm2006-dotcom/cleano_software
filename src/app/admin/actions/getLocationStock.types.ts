export type LocationStockEntry = {
  locationId: string;
  locationName: string;
  locationAddress: string | null;
  quantity: number;
};

export type ProductLocationStock = {
  productId: string;
  productName: string;
  unit: string;
  totalAcrossLocations: number;
  locations: LocationStockEntry[];
};
