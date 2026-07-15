#include "t4decoder/chart_client.hpp"

#include <curl/curl.h>

#include <mutex>
#include <stdexcept>

#include "t4decoder/n_date_time.hpp"
#include "t4decoder/payload.hpp"

namespace t4 {

namespace {

void ensureCurlGlobalInit() {
  static std::once_flag flag;
  std::call_once(flag, [] { curl_global_init(CURL_GLOBAL_DEFAULT); });
}

std::size_t writeCb(char* ptr, std::size_t size, std::size_t nmemb, void* userdata) {
  auto* out = static_cast<std::vector<std::uint8_t>*>(userdata);
  std::size_t n = size * nmemb;
  out->insert(out->end(), ptr, ptr + n);
  return n;
}

std::string stripTrailingSlashes(std::string s) {
  while (!s.empty() && s.back() == '/') s.pop_back();
  return s;
}

}  // namespace

ChartClient::ChartClient(std::string token, std::string baseUrl)
    : token_(std::move(token)), baseUrl_(stripTrailingSlashes(std::move(baseUrl))) {
  if (token_.empty()) throw std::invalid_argument("ChartClient: token is required");
  ensureCurlGlobalInit();
}

std::vector<std::uint8_t> ChartClient::get(
    const std::string& path, const std::map<std::string, std::string>& params,
    const std::string& accept) {
  CURL* curl = curl_easy_init();
  if (!curl) throw std::runtime_error("ChartClient: curl_easy_init failed");

  std::string url = baseUrl_ + path;
  // Append query string, URL-encoding values (keys are fixed url-safe tokens).
  bool first = true;
  for (const auto& kv : params) {
    if (kv.second.empty()) continue;
    char* esc = curl_easy_escape(curl, kv.second.c_str(),
                                 static_cast<int>(kv.second.size()));
    url += (first ? '?' : '&');
    url += kv.first;
    url += '=';
    url += esc ? esc : "";
    if (esc) curl_free(esc);
    first = false;
  }

  struct curl_slist* headers = nullptr;
  headers = curl_slist_append(headers, ("Authorization: Bearer " + token_).c_str());
  headers = curl_slist_append(headers, ("Accept: " + accept).c_str());

  std::vector<std::uint8_t> body;
  curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCb);
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, &body);
  curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
  curl_easy_setopt(curl, CURLOPT_USERAGENT, "t4decoder/1.0");

  CURLcode rc = curl_easy_perform(curl);
  long status = 0;
  if (rc == CURLE_OK) curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);

  curl_slist_free_all(headers);
  curl_easy_cleanup(curl);

  if (rc != CURLE_OK) {
    throw std::runtime_error(std::string("ChartClient: request failed: ") +
                             curl_easy_strerror(rc));
  }
  if (status < 200 || status >= 300) {
    std::string preview(body.begin(),
                        body.begin() + (body.size() < 256 ? body.size() : 256));
    throw std::runtime_error("ChartClient: HTTP " + std::to_string(status) +
                             ": " + preview);
  }
  return body;
}

std::map<std::string, std::string> ChartClient::barchartQuery(
    const BarchartParams& p) {
  std::map<std::string, std::string> q;
  q["exchangeId"] = p.exchangeId;
  q["contractId"] = p.contractId;
  q["chartType"] = p.chartType;
  q["barInterval"] = p.barInterval;
  q["barPeriod"] = std::to_string(p.barPeriod);
  q["tradeDateStart"] = p.tradeDateStart;
  q["tradeDateEnd"] = p.tradeDateEnd;
  if (p.marketId) q["marketID"] = *p.marketId;
  if (p.continuationType) q["continuationType"] = *p.continuationType;
  if (p.resetInterval) q["resetInterval"] = *p.resetInterval;
  return q;
}

std::map<std::string, std::string> ChartClient::tradehistoryQuery(
    const TradehistoryParams& p) {
  std::map<std::string, std::string> q;
  q["exchangeId"] = p.exchangeId;
  q["contractId"] = p.contractId;
  if (p.marketId) q["marketID"] = *p.marketId;
  if (p.tradeDateStart) q["tradeDateStart"] = *p.tradeDateStart;
  if (p.tradeDateEnd) q["tradeDateEnd"] = *p.tradeDateEnd;
  if (p.start) q["start"] = *p.start;
  if (p.end) q["end"] = *p.end;
  if (p.since) q["since"] = *p.since;
  return q;
}

void ChartClient::getBarchartBinary(const BarchartParams& params,
                                    AggrHandler& handler) {
  auto body = get("/barchart", barchartQuery(params), "application/octet-stream");
  auto payload = extractT4BinPayload(body);
  ChartDataStreamReaderAggr::read(payload, handler);
}

std::unique_ptr<ChartDataStreamReader> ChartClient::getTradehistoryBinary(
    const TradehistoryParams& params, ChartDataType dataType) {
  auto body = get("/tradehistory", tradehistoryQuery(params),
                  "application/octet-stream");
  auto payload = extractT4BinPayload(body);
  return std::make_unique<ChartDataStreamReader>(
      std::move(payload), NDateTime(0), params.marketId.value_or(std::string()),
      dataType);
}

std::string ChartClient::getBarchartJson(const BarchartParams& params) {
  auto body = get("/barchart", barchartQuery(params), "application/json");
  return std::string(body.begin(), body.end());
}

std::string ChartClient::getTradehistoryJson(const TradehistoryParams& params) {
  auto body = get("/tradehistory", tradehistoryQuery(params), "application/json");
  return std::string(body.begin(), body.end());
}

}  // namespace t4
