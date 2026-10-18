// A fixed category also constrains text searches; saved all-content rules cannot leak in.
class DefaultExtension extends TvCategoryEngine {
  constructor() {
    super();
    this.categoryKey = "__GROUP__";
    this.categories = this.categories.filter(c => c.key === this.categoryKey);
    this.contentOptions = this.categories.map(c => [c.name, c.key]);
  }
  _categoryRule(order, filters) {
    return { mode: "filter", content: this.categoryKey,
      country: this._allowed(this._filterValue(filters, "country", "전체"), this.countryOptions, "전체"),
      order: this._allowed(this._filterValue(filters, "order", order), this.orderOptions, order) };
  }
  async getPopular(page) { return this._localizeResult(await this._filterListing(page, this._categoryRule("인기순"))); }
  async getLatestUpdates(page) { return this._localizeResult(await this._filterListing(page, this._categoryRule("시간순"))); }
  async search(query, page, filters) {
    if (this._normalize(query)) return this._localizeResult(await this._textSearch(this._normalize(query), page));
    return this._localizeResult(await this._filterListing(page, this._categoryRule("시간순", filters)));
  }
  getFilterList() {
    const options = pairs => pairs.map(p => this._option(p[0], p[1]));
    return [this._select("country", "국가", options(this.countryOptions)), this._select("order", "정렬", options(this.orderOptions))];
  }
}
