//@flow

import { Observable } from "rxjs";
import WebSocket from "ws";
import axios from "axios";
import {
  currencyTickers,
  allTickers,
  supportTicker,
  pairExchange,
  pairExchangeFromId
} from "../utils";
import { logAPI, logAPIError } from "../logger";
import type { PairExchange, Provider } from "../types";

type CoinAPI_TickerMessage = {|
  time_exchange: string,
  time_coinapi: string,
  uuid: string,
  price: number,
  size: number,
  taker_side: "SELL" | "BUY",
  symbol_id: string,
  sequence: number,
  type: string
|};

type CoinAPI_Symbol = {|
  symbol_id: string,
  exchange_id: string,
  symbol_type: string,
  asset_id_base: string,
  asset_id_quote: string
|};

type CoinAPI_Exchange = {|
  exchange_id: string,
  website: string,
  name: string,
  data_start: string,
  data_end: string,
  data_quote_start: string,
  data_quote_end: string,
  data_orderbook_start: string,
  data_orderbook_end: string,
  data_trade_start: string,
  data_trade_end: string,
  data_trade_count: number,
  data_symbols_count: number
|};

type CoinAPI_Timeseries = {|
  time_period_start: string,
  time_period_end: string,
  time_open: string,
  time_close: string,
  price_open: number,
  price_high: number,
  price_low: number,
  price_close: number,
  volume_traded: number,
  trades_count: number
|};

function symbolToPairExchange(symbol: string): ?PairExchange {
  const [exchange, type, from, to] = symbol.split("_");
  if (type !== "SPOT") return;
  return pairExchange(exchange, from, to);
}

function pairExchangeIdToSymbol(pairExchangeId: string): string {
  const { from, to, exchange } = pairExchangeFromId(pairExchangeId);
  return `${exchange}_SPOT_${from}_${to}`;
}

const COINAPI_KEY = process.env.COINAPI_KEY;

function init() {
  if (!COINAPI_KEY) throw new Error("COINAPI_KEY env is not defined");
}

const get = async (url: string, opts?: *) => {
  const beforeTime = Date.now();
  try {
    const res = await axios.get(`https://rest.coinapi.io${url}`, {
      ...opts,
      timeout: 50000,
      headers: {
        "X-CoinAPI-Key": COINAPI_KEY
      }
    });
    logAPI({
      api: "CoinAPI",
      url,
      opts,
      duration: Date.now() - beforeTime,
      status: res.status
    });
    return res.data;
  } catch (error) {
    logAPIError({
      api: "CoinAPI",
      error,
      url,
      opts,
      duration: Date.now() - beforeTime
    });
    throw error;
  }
};

const fetchHistodaysSeries = async (id: string, limit: number = 3560) => {
  const days: CoinAPI_Timeseries[] = await get(
    `/v1/ohlcv/${pairExchangeIdToSymbol(id)}/latest`,
    {
      params: {
        period_id: "1DAY",
        limit
      }
    }
  );
  const timeSeries = days.map(d => ({
    time: new Date(d.time_period_start),
    open: d.price_open,
    high: d.price_high,
    low: d.price_low,
    close: d.price_close,
    volume: d.volume_traded
  }));
  return timeSeries;
};

const fetchExchanges = async () => {
  const list: CoinAPI_Exchange[] = await get("/v1/exchanges");
  const exchanges = list.map(e => ({
    id: e.exchange_id,
    name: e.name,
    website: e.website
  }));
  return exchanges;
};

const fetchAvailablePairExchanges = async () => {
  const list: CoinAPI_Symbol[] = await get("/v1/symbols", {
    params: {
      filter_symbol_id: currencyTickers
        .map(ticker => `SPOT_${ticker}`)
        .join(",")
    }
  });
  if (typeof list === "string") {
    throw new Error("/v1/symbols payload is invalid! Got a string!");
  }

  const pairExchanges = [];
  for (const item of list) {
    const pairExchange = symbolToPairExchange(item.symbol_id);
    if (
      pairExchange &&
      supportTicker(pairExchange.from) &&
      supportTicker(pairExchange.to)
    ) {
      pairExchanges.push(pairExchange);
    }
  }
  return pairExchanges;
};

const subscribePriceUpdate = () =>
  Observable.create(o => {
    const ws = new WebSocket("wss://ws.coinapi.io/v1/");
    const tickers = allTickers;
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "hello",
          apikey: COINAPI_KEY,
          heartbeat: false,
          subscribe_data_type: ["trade"],
          subscribe_filter_asset_id: tickers
        })
      );
    });
    ws.on("message", data => {
      const r = JSON.parse(data);
      if (r && typeof r === "object") {
        if (r.type === "error") {
          o.error(r.message);
          ws.close();
        } else {
          (r: CoinAPI_TickerMessage);
          const maybePairExchange = symbolToPairExchange(r.symbol_id);
          if (maybePairExchange) {
            o.next({
              pairExchangeId: maybePairExchange.id,
              price: r.price
            });
          }
        }
      }
    });
    ws.on("close", () => {
      o.complete();
    });

    function unsubscribe() {
      ws.close();
    }

    return { unsubscribe };
  });

const provider: Provider = {
  init,
  fetchHistodaysSeries,
  fetchExchanges,
  fetchAvailablePairExchanges,
  subscribePriceUpdate
};

export default provider;
