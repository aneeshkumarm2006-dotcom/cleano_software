// Metro resolves font files to an asset reference; TypeScript only needs to
// know the require is valid.
declare module "*.ttf" {
  const asset: number;
  export default asset;
}
