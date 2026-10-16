//! Bounded conversion of inert host request data, before serde owns its strings
//! and containers. Read each property once; do not preflight then deserialize
//! the original object again (getters could return different values).
use js_sys::{Array, JsString, Object, Reflect};
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};
use wasm_bindgen::{JsCast, JsError, JsValue};

pub(crate) struct InputBudget {
    work: usize,
    nodes: usize,
}

fn rejected() -> JsError {
    JsError::new("request input rejected")
}

impl InputBudget {
    pub(crate) fn new() -> Self {
        Self {
            work: 16 * 1024 * 1024,
            nodes: 65_536,
        }
    }

    fn debit(&mut self, work: usize) -> Result<(), JsError> {
        self.work = self.work.checked_sub(work).ok_or_else(rejected)?;
        Ok(())
    }

    fn string(&mut self, value: &JsValue) -> Result<String, JsError> {
        if !value.is_string() {
            return Err(rejected());
        }
        // A UTF-16 code unit requires at most three UTF-8 bytes. Charge BEFORE
        // as_string allocates/copies into Rust, including replacement encoding.
        let units = value.unchecked_ref::<JsString>().length() as usize;
        self.debit(
            units
                .checked_mul(3)
                .and_then(|n| n.checked_add(2))
                .ok_or_else(rejected)?,
        )?;
        value.as_string().ok_or_else(rejected)
    }

    pub(crate) fn decode<T: DeserializeOwned>(&mut self, value: JsValue) -> Result<T, JsError> {
        let value = self.value(&value, 0)?;
        serde_json::from_value(value).map_err(|_| rejected())
    }

    // Reflect descriptors inspect own data without invoking accessors. Proxy
    // exceptions are caught and sanitized, not echoed. Host JS execution and
    // its own key-enumeration allocation remain outside the Rust memory budget.
    fn property(target: &JsValue, key: &JsValue) -> Result<JsValue, JsError> {
        let descriptor =
            Reflect::get_own_property_descriptor(target.unchecked_ref::<Object>(), key)
                .map_err(|_| rejected())?;
        if descriptor.is_undefined() {
            return Ok(JsValue::UNDEFINED);
        }
        if !Reflect::has(&descriptor, &JsValue::from_str("value")).map_err(|_| rejected())? {
            return Err(rejected());
        }
        Reflect::get(&descriptor, &JsValue::from_str("value")).map_err(|_| rejected())
    }

    fn value(&mut self, value: &JsValue, depth: usize) -> Result<Value, JsError> {
        if depth > 64 {
            return Err(rejected());
        }
        self.nodes = self.nodes.checked_sub(1).ok_or_else(rejected)?;
        if value.is_null() || value.is_undefined() {
            self.debit(4)?;
            return Ok(Value::Null);
        }
        if let Some(value) = value.as_bool() {
            self.debit(5)?;
            return Ok(Value::Bool(value));
        }
        if let Some(value) = value.as_f64() {
            self.debit(24)?;
            if !value.is_finite() {
                return Err(rejected());
            }
            return Ok(
                if value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_991.0 {
                    Value::Number((value as i64).into())
                } else {
                    Value::Number(serde_json::Number::from_f64(value).ok_or_else(rejected)?)
                },
            );
        }
        if value.is_string() {
            return self.string(value).map(Value::String);
        }
        self.debit(2)?;
        if Array::is_array(value) {
            let length = Reflect::get(value, &JsValue::from_str("length"))
                .map_err(|_| rejected())?
                .as_f64()
                .filter(|n| {
                    n.is_finite() && *n >= 0.0 && n.fract() == 0.0 && *n <= self.nodes as f64
                })
                .ok_or_else(rejected)? as usize;
            self.debit(length)?;
            let mut result = Vec::with_capacity(length);
            for index in 0..length {
                let item = Self::property(value, &JsValue::from_f64(index as f64))?;
                result.push(self.value(&item, depth + 1)?);
            }
            return Ok(Value::Array(result));
        }
        if value.is_instance_of::<js_sys::Map>() {
            let iterator = js_sys::try_iter(value)
                .map_err(|_| rejected())?
                .ok_or_else(rejected)?;
            let mut result = Map::new();
            for pair in iterator {
                let pair = pair.map_err(|_| rejected())?;
                if !Array::is_array(&pair) {
                    return Err(rejected());
                }
                let key = Self::property(&pair, &JsValue::from_f64(0.0))?;
                let key = self.string(&key)?;
                let raw = Self::property(&pair, &JsValue::from_f64(1.0))?;
                let item = self.value(&raw, depth + 1)?;
                result.insert(key, item);
            }
            return Ok(Value::Object(result));
        }
        if !value.is_object() || value.is_instance_of::<js_sys::Function>() {
            return Err(rejected());
        }
        // JSON records (including null-prototype dictionaries), not opaque host
        // objects such as Date/Set/typed arrays silently reinterpreted as maps.
        let prototype =
            Reflect::get_prototype_of(value.unchecked_ref::<Object>()).map_err(|_| rejected())?;
        let ordinary = Reflect::get_prototype_of(&Object::new()).map_err(|_| rejected())?;
        let prototype_value: &JsValue = prototype.as_ref();
        let ordinary_value: &JsValue = ordinary.as_ref();
        if !prototype_value.is_null() && prototype_value != ordinary_value {
            return Err(rejected());
        }
        let keys = Reflect::own_keys(value).map_err(|_| rejected())?;
        if keys.length() as usize > self.nodes {
            return Err(rejected());
        }
        let mut result = Map::new();
        for key in keys.iter() {
            if !key.is_string() {
                continue;
            }
            let descriptor =
                Reflect::get_own_property_descriptor(value.unchecked_ref::<Object>(), &key)
                    .map_err(|_| rejected())?;
            if descriptor.is_undefined() {
                continue;
            }
            if Reflect::get(&descriptor, &JsValue::from_str("enumerable"))
                .map_err(|_| rejected())?
                .as_bool()
                != Some(true)
            {
                continue;
            }
            if !Reflect::has(&descriptor, &JsValue::from_str("value")).map_err(|_| rejected())? {
                return Err(rejected());
            }
            let key = self.string(&key)?;
            let raw =
                Reflect::get(&descriptor, &JsValue::from_str("value")).map_err(|_| rejected())?;
            result.insert(key, self.value(&raw, depth + 1)?);
        }
        Ok(Value::Object(result))
    }
}
