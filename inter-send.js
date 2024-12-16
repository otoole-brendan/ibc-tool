/* global crypto */
import { SigningStargateClient } from 'https://esm.run/@cosmjs/stargate';

const { entries, freeze, fromEntries } = Object;

export const fail = msg => {
  throw new Error(msg);
};

// ack: https://stackoverflow.com/a/40031979/7963
function buf2hex(buffer) {
  // buffer is an ArrayBuffer
  return [...new Uint8Array(buffer)]
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');
}

const te = new TextEncoder();
// https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
const sha256 = txt =>
  crypto.subtle.digest('SHA-256', te.encode(txt)).then(buf => buf2hex(buf));

export const mapValues = (obj, f) =>
  fromEntries(entries(obj).map(([k, v]) => [k, f(v)]));

export const makeDocTools = document => {
  const elt = (tag, attrs = {}, children = []) => {
    const it = document.createElement(tag);
    entries(attrs).forEach(([name, value]) => it.setAttribute(name, value));
    children.forEach(ch => {
      if (typeof ch === 'string') {
        it.appendChild(document.createTextNode(ch));
      } else {
        it.appendChild(ch);
      }
    });
    return it;
  };
  const setChoices = (sel, choices, labelProp, valProp) => {
    sel.innerHTML = '';
    for (const item of choices) {
      const opt = elt('option', { value: item[valProp] }, [
        item[labelProp] || item[valProp],
      ]);
      sel.appendChild(opt);
    }
  };

  const $ = sel => document.querySelector(sel) || fail(sel);
  const $in = name => $(`*[name="${name}"]`);

  const errorBoundary = f => async () => {
    try {
      await f();
    } catch (e) {
      console.error(e);
      // HACK: result is hard-coded
      $('textarea[name="result"]').value = e.message;
    }
  };
  return { $, $in, errorBoundary, elt, setChoices };
};

export const makeTool = ({ fetch, keplr }) => {
  let signer;
  let account;
  let chainInfo;

  const getJSON = async url => {
    const res = await fetch(url);
    if (!res.ok) {
      throw Error(res.statusText);
    }
    return res.json();
  };
  const pickChain = async name => {
    const url = `https://raw.githubusercontent.com/cosmos/chain-registry/master/${name}/chain.json`;
    const info = await getJSON(url);
    console.log({ info });
    chainInfo = info;
    return info;
  };

  const connect = async () => {
    const { chain_id: chainId } = chainInfo;
    keplr.enable(chainId);

    signer = await keplr.getOfflineSigner(chainId);
    console.log({ signer });

    const accounts = await signer.getAccounts();
    if (accounts.length > 1) {
      // Currently, Keplr extension manages only one address/public key pair.
      console.warn('Got multiple accounts from Keplr. Using first of list.');
    }
    account = accounts[0];

    return account;
  };

  const getBalances = async lcd => {
    const { address } = account;
    const url = `${lcd}/cosmos/bank/v1beta1/balances/${address}`;
    const detail = await getJSON(url);
    return detail;
  };

  const getSupply = async lcd => {
    const { chain_id: chainId } = chainInfo;
    const supply = await getJSON(`${lcd}/cosmos/bank/v1beta1/supply`);
    console.log({ chainId, supply });
    return supply;
  };

  const denomHash = async ({ channel, denom, port = 'transfer' }) => {
    const path = `${port}/${channel}/${denom}`;
    return sha256(path);
  };

  const send = async (fields, { now = Date.now } = {}) => {
    const {
      srcRpc,
      srcChannel,
      srcPort = 'transfer',
      to,
      amount,
      denom,
      secondsUntilTimeout = 300,
      gas = '100000',
    } = fields;
    // cribbed from https://github.com/Agoric/wallet-app/blob/main/wallet/src/util/ibcTransfer.ts
    const client = await SigningStargateClient.connectWithSigner(
      srcRpc,
      signer,
    );
    const { address: from } = account;

    const timeoutTimestampSeconds = () =>
      Math.round(now() / 1000) + secondsUntilTimeout;

    return client.sendIbcTokens(
      from,
      to,
      {
        amount,
        denom,
      },
      srcPort,
      srcChannel,
      undefined,
      timeoutTimestampSeconds(),
      {
        amount: [{ amount: '0', denom }],
        gas,
      },
    );
  };

  return freeze({
    pickChain,
    connect,
    getBalances,
    getSupply,
    // denomHash,
    send,
  });
};
