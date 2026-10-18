// Keep all first-party boards belonging to this category, with per-board pagination.
class DefaultExtension extends TvCategoryEngine {
  constructor() {
    super();
    this.categoryKey = "__GROUP__";
    this.categoryBoards = __BOARDS__;
  }
  _mergeCategoryResults(results) {
    const seen = {}, list = [];
    for (const result of results) for (const item of result.list || []) {
      const path = this._seriesPath(item.link);
      if (!path || this.categoryBoards.indexOf(path.split("/")[1]) < 0 || seen[path]) continue;
      seen[path] = true; list.push(item);
    }
    return { list, hasNextPage: results.some(r => r.hasNextPage === true) };
  }
  async _categoryResults(page, mode, period, query) {
    const results = [];
    for (const category of this.categoryBoards) {
      if (query) {
        const filters = [this._select("category", "카테고리", [[category, category]]),
          this._select("mode", "목록 방식", [[mode, mode]])];
        results.push(await super.search(query, page, filters));
      } else if (mode === "popular") results.push(await this._ranking(page, period, category, false));
      else results.push(await this._listing("/" + category, page));
    }
    return this._mergeCategoryResults(results);
  }
  async getPopular(page) { return this._categoryResults(page, "popular", "d", ""); }
  async getLatestUpdates(page) { return this._categoryResults(page, "latest", "d", ""); }
  async search(query, page, filters) {
    const mode = this._filterValue(filters, "mode", "latest") === "popular" ? "popular" : "latest";
    const period = this._filterValue(filters, "period", "d");
    return this._categoryResults(page, mode, this.periods.some(p => p[1] === period) ? period : "d", this._normalize(query));
  }
  getFilterList() {
    return [this._select("period", "인기 기간", this.periods), this._select("mode", "정렬", [["최신", "latest"], ["인기", "popular"]])];
  }
}
