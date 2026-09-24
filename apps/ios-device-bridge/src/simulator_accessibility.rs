//! The accessibility tree of the frontmost app on a booted simulator, read headless through two private
//! frameworks loaded at run time: CoreSimulator carries each request to the device, and
//! AccessibilityPlatformTranslation turns the answers into elements. The daemon keeps one process per
//! simulator and asks it over stdin and stdout, one JSON object per line.

use std::{
    cell::Cell,
    ffi::{CStr, CString, c_char, c_int, c_void},
    io::{self, BufRead, Write},
    panic::AssertUnwindSafe,
    process::Command,
    rc::Rc,
    sync::mpsc,
    time::{Duration, Instant},
};

use block2::{Block, RcBlock};
use objc2::{
    AllocAnyThread, DefinedClass, define_class,
    encode::{Encode, Encoding},
    msg_send,
    rc::{Retained, autoreleasepool},
    runtime::{AnyClass, AnyObject, Bool, NSObject, Sel},
    sel,
};
use serde::{Deserialize, Serialize};

const CORE_SIMULATOR: &CStr =
    c"/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator";
const PLATFORM_TRANSLATION: &CStr = c"/System/Library/PrivateFrameworks/AccessibilityPlatformTranslation.framework/AccessibilityPlatformTranslation";
const RTLD_NOW: c_int = 2;
/// `SimDeviceStateBooted` in CoreSimulator.
const BOOTED: usize = 3;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_DEPTH: usize = 64;
const MAX_ELEMENTS: usize = 2000;

unsafe extern "C" {
    fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
    fn dlerror() -> *const c_char;
    fn dispatch_queue_create(label: *const c_char, attribute: *const c_void) -> *mut c_void;
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct CGSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

// SAFETY: the layouts match CoreGraphics on 64-bit Apple platforms, where CGFloat is a double.
unsafe impl Encode for CGPoint {
    const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}

// SAFETY: as for CGPoint.
unsafe impl Encode for CGSize {
    const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
}

// SAFETY: as for CGPoint.
unsafe impl Encode for CGRect {
    const ENCODING: Encoding = Encoding::Struct("CGRect", &[CGPoint::ENCODING, CGSize::ENCODING]);
}

#[derive(Debug, PartialEq)]
pub struct TreeError {
    pub code: &'static str,
    pub message: String,
}

impl TreeError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn unavailable(message: impl Into<String>) -> Self {
        Self::new("unavailable", message)
    }
}

type TreeResult<T> = Result<T, TreeError>;

#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Request {
    Tree {
        id: u64,
        #[serde(rename = "timeoutMs")]
        timeout_ms: Option<u64>,
    },
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// One element in device points, origin top left; text the element does not have is null.
#[derive(Debug, Serialize, PartialEq)]
pub struct Node {
    pub role: Option<String>,
    pub subrole: Option<String>,
    pub label: Option<String>,
    pub value: Option<String>,
    pub identifier: Option<String>,
    pub frame: Frame,
    pub enabled: bool,
    pub children: Vec<Node>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Reply {
    /// `scale` is the screen's pixels per point, null when the device type does not say.
    Ready { scale: Option<f64> },
    Tree {
        id: u64,
        scale: Option<f64>,
        root: Node,
        truncated: bool,
        ms: u64,
    },
    Error {
        id: Option<u64>,
        code: &'static str,
        message: String,
    },
}

impl Reply {
    fn failed(id: Option<u64>, error: TreeError) -> Self {
        Self::Error {
            id,
            code: error.code,
            message: error.message,
        }
    }
}

/// How long a tree may take: the daemon's wish within bounds, since the first read after a boot
/// waits seconds for the device's accessibility runtime.
pub fn timeout_of(timeout_ms: Option<u64>) -> Duration {
    timeout_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_TIMEOUT)
        .clamp(Duration::from_millis(100), MAX_TIMEOUT)
}

/// Answers the daemon until stdin closes; the exit code of the process.
pub fn run(udid: &str) -> i32 {
    let mut output = io::stdout().lock();
    let reader = match Reader::open(udid) {
        Ok(reader) => reader,
        Err(error) => {
            let _ = write_reply(&mut output, &Reply::failed(None, error));
            return 1;
        }
    };
    if write_reply(
        &mut output,
        &Reply::Ready {
            scale: reader.scale,
        },
    )
    .is_err()
    {
        return 1;
    }
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else {
            break;
        };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Request>(&line) {
            Ok(Request::Tree { id, timeout_ms }) => reader.tree(id, timeout_of(timeout_ms)),
            Err(error) => Reply::failed(
                None,
                TreeError::new("protocol", format!("unknown request: {error}")),
            ),
        };
        if write_reply(&mut output, &reply).is_err() {
            break;
        }
    }
    0
}

fn write_reply(output: &mut impl Write, reply: &Reply) -> io::Result<()> {
    serde_json::to_writer(&mut *output, reply)?;
    output.write_all(b"\n")?;
    output.flush()
}

/// Every class this reader speaks to, each checked for the selectors it needs before the first read.
struct Classes {
    string: &'static AnyClass,
    attributed_string: &'static AnyClass,
    number: &'static AnyClass,
    array: &'static AnyClass,
    translator_response: &'static AnyClass,
}

fn class(name: &CStr) -> TreeResult<&'static AnyClass> {
    AnyClass::get(name).ok_or_else(|| {
        TreeError::unavailable(format!(
            "this macOS or Xcode has no {}",
            name.to_string_lossy()
        ))
    })
}

fn require_class_method(class: &AnyClass, selector: Sel) -> TreeResult<()> {
    class.class_method(selector).map(|_| ()).ok_or_else(|| {
        TreeError::unavailable(format!(
            "+[{} {selector}] is missing",
            class.name().to_string_lossy()
        ))
    })
}

fn require_methods(class: &AnyClass, selectors: &[Sel]) -> TreeResult<()> {
    for selector in selectors {
        if class.instance_method(*selector).is_none() {
            return Err(TreeError::unavailable(format!(
                "-[{} {selector}] is missing",
                class.name().to_string_lossy()
            )));
        }
    }
    Ok(())
}

fn load(path: &CStr) -> TreeResult<()> {
    // SAFETY: dlopen takes a NUL-terminated path, and dlerror's text is only read before the next call.
    let handle = unsafe { dlopen(path.as_ptr(), RTLD_NOW) };
    if handle.is_null() {
        let reason = unsafe { dlerror() };
        let reason = if reason.is_null() {
            String::from("unknown error")
        } else {
            unsafe { CStr::from_ptr(reason) }
                .to_string_lossy()
                .into_owned()
        };
        return Err(TreeError::unavailable(format!(
            "{} could not be loaded: {reason}",
            path.to_string_lossy()
        )));
    }
    Ok(())
}

fn developer_dir() -> TreeResult<String> {
    let output = Command::new("xcode-select")
        .arg("-p")
        .output()
        .map_err(|error| TreeError::unavailable(format!("xcode-select could not run: {error}")))?;
    let path = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if !output.status.success() || path.is_empty() {
        return Err(TreeError::unavailable(
            "xcode-select names no developer directory",
        ));
    }
    Ok(path)
}

fn ns_string(text: &str) -> TreeResult<Retained<AnyObject>> {
    let text = CString::new(text).map_err(|_| TreeError::new("protocol", "text holds a NUL"))?;
    let string: Option<Retained<AnyObject>> =
        unsafe { msg_send![class(c"NSString")?, stringWithUTF8String: text.as_ptr()] };
    string.ok_or_else(|| TreeError::unavailable("NSString could not be made"))
}

/// Everything a request callback needs, shared with the block the translator calls.
struct Session {
    device: Retained<AnyObject>,
    queue: Retained<AnyObject>,
    empty_response: &'static AnyClass,
    deadline: Cell<Instant>,
    timed_out: Cell<bool>,
}

/// A response retained on the completion queue and handed to the reading thread.
struct Response(Option<Retained<AnyObject>>);

// SAFETY: Objective-C reference counts are atomic, and the reading thread only touches the object
// after the channel handed it over.
unsafe impl Send for Response {}

impl Session {
    /// Sends one translator request to the device and waits for its answer, never past the deadline.
    fn send(&self, request: *mut AnyObject) -> *mut AnyObject {
        if request.is_null() {
            return self.empty();
        }
        let remaining = self
            .deadline
            .get()
            .saturating_duration_since(Instant::now());
        if self.timed_out.get() || remaining.is_zero() {
            self.timed_out.set(true);
            return self.empty();
        }
        let (sender, receiver) = mpsc::sync_channel::<Response>(1);
        let handler = RcBlock::new(move |response: *mut AnyObject| {
            // A reply after the wait gave up finds the channel closed and is released with it.
            let _ = sender.try_send(Response(unsafe { Retained::retain(response) }));
        });
        // SAFETY: the selector was checked when the reader opened, and CoreSimulator copies the block.
        unsafe {
            let _: () = msg_send![
                &*self.device,
                sendAccessibilityRequestAsync: request,
                completionQueue: &*self.queue,
                completionHandler: &*handler
            ];
        }
        match receiver.recv_timeout(remaining) {
            Ok(Response(Some(response))) => Retained::autorelease_return(response),
            Ok(Response(None)) => self.empty(),
            Err(_) => {
                self.timed_out.set(true);
                self.empty()
            }
        }
    }

    fn empty(&self) -> *mut AnyObject {
        let response: *mut AnyObject = unsafe { msg_send![self.empty_response, emptyResponse] };
        response
    }
}

type RequestBlock = RcBlock<dyn Fn(*mut AnyObject) -> *mut AnyObject>;

struct DelegateIvars {
    callback: RequestBlock,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements, and the class does not implement Drop.
    #[unsafe(super(NSObject))]
    #[name = "RuimteSimulatorAccessibilityDelegate"]
    #[ivars = DelegateIvars]
    struct TokenDelegate;

    impl TokenDelegate {
        #[unsafe(method(accessibilityTranslationDelegateBridgeCallbackWithToken:))]
        fn bridge_callback(
            &self,
            _token: *mut AnyObject,
        ) -> *mut Block<dyn Fn(*mut AnyObject) -> *mut AnyObject> {
            RcBlock::as_ptr(&self.ivars().callback)
        }

        #[unsafe(method(accessibilityTranslationConvertPlatformFrameToSystem:withToken:))]
        fn convert_frame(&self, rect: CGRect, _token: *mut AnyObject) -> CGRect {
            rect
        }

        #[unsafe(method(accessibilityTranslationRootParentWithToken:))]
        fn root_parent(&self, _token: *mut AnyObject) -> *mut AnyObject {
            std::ptr::null_mut()
        }
    }
);

impl TokenDelegate {
    fn new(callback: RequestBlock) -> Retained<Self> {
        let this = Self::alloc().set_ivars(DelegateIvars { callback });
        unsafe { msg_send![super(this), init] }
    }
}

struct Reader {
    classes: Classes,
    session: Rc<Session>,
    translator: Retained<AnyObject>,
    token: Retained<AnyObject>,
    scale: Option<f64>,
    // The translator may hold its delegate weakly, so the reader keeps it alive.
    _delegate: Retained<TokenDelegate>,
}

impl Reader {
    fn open(udid: &str) -> TreeResult<Self> {
        let developer_dir = developer_dir()?;
        load(CORE_SIMULATOR)?;
        load(PLATFORM_TRANSLATION)?;

        let context_class = class(c"SimServiceContext")?;
        let translator_class = class(c"AXPTranslator")?;
        let translator_response = class(c"AXPTranslatorResponse")?;
        require_class_method(
            context_class,
            sel!(sharedServiceContextForDeveloperDir:error:),
        )?;
        require_methods(context_class, &[sel!(defaultDeviceSetWithError:)])?;
        require_methods(class(c"SimDeviceSet")?, &[sel!(devices)])?;
        require_methods(
            class(c"SimDevice")?,
            &[
                sel!(UDID),
                sel!(state),
                sel!(sendAccessibilityRequestAsync:completionQueue:completionHandler:),
            ],
        )?;
        require_class_method(translator_class, sel!(sharedInstance))?;
        require_methods(
            translator_class,
            &[
                sel!(setBridgeTokenDelegate:),
                sel!(setSupportsDelegateTokens:),
                sel!(setAccessibilityEnabled:),
                sel!(frontmostApplicationWithDisplayId:bridgeDelegateToken:),
                sel!(macPlatformElementFromTranslation:),
            ],
        )?;
        require_class_method(translator_response, sel!(emptyResponse))?;
        require_methods(
            class(c"AXPTranslationObject")?,
            &[sel!(setBridgeDelegateToken:)],
        )?;
        require_methods(
            class(c"AXPMacPlatformElement")?,
            &[
                sel!(translation),
                sel!(accessibilityRole),
                sel!(accessibilitySubrole),
                sel!(accessibilityLabel),
                sel!(accessibilityValue),
                sel!(accessibilityIdentifier),
                sel!(accessibilityFrame),
                sel!(isAccessibilityEnabled),
                sel!(accessibilityChildren),
            ],
        )?;
        let classes = Classes {
            string: class(c"NSString")?,
            attributed_string: class(c"NSAttributedString")?,
            number: class(c"NSNumber")?,
            array: class(c"NSArray")?,
            translator_response,
        };

        let device = find_device(context_class, &developer_dir, udid, &classes)?;
        let scale = screen_scale(&device);
        // SAFETY: a serial queue of our own; CoreSimulator answers on it while the reading thread waits.
        let queue = unsafe {
            Retained::from_raw(
                dispatch_queue_create(
                    c"app.ruimte.simulator-accessibility".as_ptr(),
                    std::ptr::null(),
                )
                .cast::<AnyObject>(),
            )
        }
        .ok_or_else(|| TreeError::unavailable("could not create a dispatch queue"))?;
        let session = Rc::new(Session {
            device,
            queue,
            empty_response: classes.translator_response,
            deadline: Cell::new(Instant::now()),
            timed_out: Cell::new(false),
        });
        let shared = Rc::clone(&session);
        let callback: RequestBlock =
            RcBlock::new(move |request: *mut AnyObject| shared.send(request));
        let delegate = TokenDelegate::new(callback);

        let translator: Option<Retained<AnyObject>> =
            unsafe { msg_send![translator_class, sharedInstance] };
        let translator = translator
            .ok_or_else(|| TreeError::unavailable("AXPTranslator has no shared instance"))?;
        unsafe {
            let _: () = msg_send![&*translator, setBridgeTokenDelegate: &*delegate];
            let _: () = msg_send![&*translator, setSupportsDelegateTokens: Bool::YES];
            let _: () = msg_send![&*translator, setAccessibilityEnabled: Bool::YES];
        }
        let uuid: Option<Retained<AnyObject>> = unsafe { msg_send![class(c"NSUUID")?, UUID] };
        let uuid = uuid.ok_or_else(|| TreeError::unavailable("NSUUID made no identifier"))?;
        let token: Option<Retained<AnyObject>> = unsafe { msg_send![&*uuid, UUIDString] };
        let token = token.ok_or_else(|| TreeError::unavailable("NSUUID gave no string"))?;

        Ok(Self {
            classes,
            session,
            translator,
            token,
            scale,
            _delegate: delegate,
        })
    }

    fn tree(&self, id: u64, timeout: Duration) -> Reply {
        let started = Instant::now();
        self.session.deadline.set(started + timeout);
        self.session.timed_out.set(false);
        let state: usize = unsafe { msg_send![&*self.session.device, state] };
        if state != BOOTED {
            return Reply::failed(
                Some(id),
                TreeError::new("device-not-booted", "the simulator is not booted"),
            );
        }
        let walked = autoreleasepool(|_| {
            objc2::exception::catch(AssertUnwindSafe(|| self.walk_frontmost()))
        });
        let result = match walked {
            Ok(result) => result,
            Err(exception) => Err(TreeError::new(
                "exception",
                format!(
                    "the accessibility runtime raised {}",
                    exception
                        .map(|exception| format!("{exception:?}"))
                        .unwrap_or_else(|| String::from("an exception"))
                ),
            )),
        };
        if self.session.timed_out.get() {
            return Reply::failed(
                Some(id),
                TreeError::new(
                    "timeout",
                    format!(
                        "the simulator did not answer within {} ms",
                        timeout.as_millis()
                    ),
                ),
            );
        }
        match result {
            Ok((root, truncated)) => Reply::Tree {
                id,
                scale: self.scale,
                root,
                truncated,
                ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
            },
            Err(error) => Reply::failed(Some(id), error),
        }
    }

    fn walk_frontmost(&self) -> TreeResult<(Node, bool)> {
        let application: Option<Retained<AnyObject>> = unsafe {
            msg_send![
                &*self.translator,
                frontmostApplicationWithDisplayId: 0_u32,
                bridgeDelegateToken: &*self.token
            ]
        };
        let application = application.ok_or_else(|| {
            TreeError::new("no-frontmost-app", "the simulator shows no app to read")
        })?;
        unsafe {
            let _: () = msg_send![&*application, setBridgeDelegateToken: &*self.token];
        }
        let root: Option<Retained<AnyObject>> = unsafe {
            msg_send![&*self.translator, macPlatformElementFromTranslation: &*application]
        };
        let root = root.ok_or_else(|| {
            TreeError::new(
                "no-frontmost-app",
                "the frontmost app has no accessibility element",
            )
        })?;
        let mut count = 0;
        let node = self.node(&root, 0, &mut count);
        Ok((node, count >= MAX_ELEMENTS))
    }

    fn node(&self, element: &AnyObject, depth: usize, count: &mut usize) -> Node {
        *count += 1;
        self.stamp(element);
        let role: Option<Retained<AnyObject>> = unsafe { msg_send![element, accessibilityRole] };
        let subrole: Option<Retained<AnyObject>> =
            unsafe { msg_send![element, accessibilitySubrole] };
        let label: Option<Retained<AnyObject>> = unsafe { msg_send![element, accessibilityLabel] };
        let value: Option<Retained<AnyObject>> = unsafe { msg_send![element, accessibilityValue] };
        let identifier: Option<Retained<AnyObject>> =
            unsafe { msg_send![element, accessibilityIdentifier] };
        let frame: CGRect = unsafe { msg_send![element, accessibilityFrame] };
        let enabled: Bool = unsafe { msg_send![element, isAccessibilityEnabled] };
        let mut node = Node {
            role: self.text(role),
            subrole: self.text(subrole),
            label: self.text(label),
            value: self.text(value),
            identifier: self.text(identifier),
            frame: Frame {
                x: frame.origin.x,
                y: frame.origin.y,
                width: frame.size.width,
                height: frame.size.height,
            },
            enabled: enabled.as_bool(),
            children: Vec::new(),
        };
        if depth >= MAX_DEPTH || self.session.timed_out.get() {
            return node;
        }
        let children: Option<Retained<AnyObject>> =
            unsafe { msg_send![element, accessibilityChildren] };
        let Some(children) = children.filter(|children| self.is_kind(children, self.classes.array))
        else {
            return node;
        };
        let length: usize = unsafe { msg_send![&*children, count] };
        for index in 0..length {
            if *count >= MAX_ELEMENTS || self.session.timed_out.get() {
                break;
            }
            let child: Option<Retained<AnyObject>> =
                unsafe { msg_send![&*children, objectAtIndex: index] };
            if let Some(child) = child {
                node.children.push(self.node(&child, depth + 1, count));
            }
        }
        node
    }

    /// Every element carries the token its answers are routed by, and a child does not inherit it.
    fn stamp(&self, element: &AnyObject) {
        if !element.class().responds_to(sel!(translation)) {
            return;
        }
        let translation: Option<Retained<AnyObject>> = unsafe { msg_send![element, translation] };
        if let Some(translation) = translation
            && translation
                .class()
                .responds_to(sel!(setBridgeDelegateToken:))
        {
            unsafe {
                let _: () = msg_send![&*translation, setBridgeDelegateToken: &*self.token];
            }
        }
    }

    fn is_kind(&self, object: &AnyObject, class: &AnyClass) -> bool {
        let kind: Bool = unsafe { msg_send![object, isKindOfClass: class] };
        kind.as_bool()
    }

    fn text(&self, object: Option<Retained<AnyObject>>) -> Option<String> {
        let object = object?;
        let object = &*object;
        let string: Option<Retained<AnyObject>> =
            if self.is_kind(object, self.classes.attributed_string) {
                unsafe { msg_send![object, string] }
            } else if self.is_kind(object, self.classes.number) {
                unsafe { msg_send![object, stringValue] }
            } else if self.is_kind(object, self.classes.string) {
                unsafe { Retained::retain(object as *const AnyObject as *mut AnyObject) }
            } else {
                None
            };
        let string = string?;
        let utf8: *const c_char = unsafe { msg_send![&*string, UTF8String] };
        if utf8.is_null() {
            return None;
        }
        Some(
            unsafe { CStr::from_ptr(utf8) }
                .to_string_lossy()
                .into_owned(),
        )
    }
}

fn find_device(
    context_class: &AnyClass,
    developer_dir: &str,
    udid: &str,
    classes: &Classes,
) -> TreeResult<Retained<AnyObject>> {
    let directory = ns_string(developer_dir)?;
    let mut error: *mut AnyObject = std::ptr::null_mut();
    let context: Option<Retained<AnyObject>> = unsafe {
        msg_send![context_class, sharedServiceContextForDeveloperDir: &*directory, error: &mut error]
    };
    let context = context.ok_or_else(|| {
        TreeError::unavailable("CoreSimulator has no service context for this Xcode")
    })?;
    let set: Option<Retained<AnyObject>> =
        unsafe { msg_send![&*context, defaultDeviceSetWithError: &mut error] };
    let set =
        set.ok_or_else(|| TreeError::unavailable("CoreSimulator has no default device set"))?;
    let devices: Option<Retained<AnyObject>> = unsafe { msg_send![&*set, devices] };
    let devices =
        devices.ok_or_else(|| TreeError::unavailable("CoreSimulator lists no devices"))?;
    let is_array: Bool = unsafe { msg_send![&*devices, isKindOfClass: classes.array] };
    if !is_array.as_bool() {
        return Err(TreeError::unavailable(
            "CoreSimulator lists its devices in an unknown shape",
        ));
    }
    let length: usize = unsafe { msg_send![&*devices, count] };
    for index in 0..length {
        let device: Option<Retained<AnyObject>> =
            unsafe { msg_send![&*devices, objectAtIndex: index] };
        let Some(device) = device else {
            continue;
        };
        let identifier: Option<Retained<AnyObject>> = unsafe { msg_send![&*device, UDID] };
        let Some(identifier) = identifier else {
            continue;
        };
        let string: Option<Retained<AnyObject>> = unsafe { msg_send![&*identifier, UUIDString] };
        let Some(string) = string else {
            continue;
        };
        let utf8: *const c_char = unsafe { msg_send![&*string, UTF8String] };
        if !utf8.is_null()
            && unsafe { CStr::from_ptr(utf8) }
                .to_string_lossy()
                .eq_ignore_ascii_case(udid)
        {
            return Ok(device);
        }
    }
    Err(TreeError::new(
        "device-not-found",
        format!("no simulator has the UDID {udid}"),
    ))
}

/// Pixels per point of the device's screen, which a screenshot is taken at.
fn screen_scale(device: &AnyObject) -> Option<f64> {
    if !device.class().responds_to(sel!(deviceType)) {
        return None;
    }
    let device_type: Option<Retained<AnyObject>> = unsafe { msg_send![device, deviceType] };
    let device_type = device_type?;
    if !device_type.class().responds_to(sel!(mainScreenScale)) {
        return None;
    }
    let scale: f32 = unsafe { msg_send![&*device_type, mainScreenScale] };
    (scale.is_finite() && scale > 0.0).then_some(f64::from(scale))
}

#[cfg(test)]
mod tests {
    use super::{DEFAULT_TIMEOUT, Frame, MAX_TIMEOUT, Node, Reply, Request, TreeError, timeout_of};
    use std::time::Duration;

    #[test]
    fn a_tree_request_reads_with_and_without_a_timeout() {
        assert_eq!(
            serde_json::from_str::<Request>(r#"{"type":"tree","id":4}"#).unwrap(),
            Request::Tree {
                id: 4,
                timeout_ms: None
            }
        );
        assert_eq!(
            serde_json::from_str::<Request>(r#"{"type":"tree","id":5,"timeoutMs":2500}"#).unwrap(),
            Request::Tree {
                id: 5,
                timeout_ms: Some(2500)
            }
        );
        assert!(serde_json::from_str::<Request>(r#"{"type":"tap","id":6}"#).is_err());
    }

    #[test]
    fn the_timeout_stays_within_its_bounds() {
        assert_eq!(timeout_of(None), DEFAULT_TIMEOUT);
        assert_eq!(timeout_of(Some(2500)), Duration::from_millis(2500));
        assert_eq!(timeout_of(Some(0)), Duration::from_millis(100));
        assert_eq!(timeout_of(Some(u64::MAX)), MAX_TIMEOUT);
    }

    #[test]
    fn replies_match_the_daemon_protocol() {
        let tree = Reply::Tree {
            id: 1,
            scale: Some(3.0),
            root: Node {
                role: Some(String::from("AXApplication")),
                subrole: None,
                label: Some(String::from("Settings")),
                value: None,
                identifier: None,
                frame: Frame {
                    x: 0.0,
                    y: 0.0,
                    width: 402.0,
                    height: 874.0,
                },
                enabled: true,
                children: Vec::new(),
            },
            truncated: false,
            ms: 20,
        };
        assert_eq!(
            serde_json::to_value(&tree).unwrap(),
            serde_json::json!({
                "type": "tree",
                "id": 1,
                "scale": 3.0,
                "root": {
                    "role": "AXApplication",
                    "subrole": null,
                    "label": "Settings",
                    "value": null,
                    "identifier": null,
                    "frame": { "x": 0.0, "y": 0.0, "width": 402.0, "height": 874.0 },
                    "enabled": true,
                    "children": []
                },
                "truncated": false,
                "ms": 20
            })
        );
        assert_eq!(
            serde_json::to_value(Reply::failed(None, TreeError::new("unavailable", "gone")))
                .unwrap(),
            serde_json::json!({ "type": "error", "id": null, "code": "unavailable", "message": "gone" })
        );
        assert_eq!(
            serde_json::to_value(Reply::Ready { scale: None }).unwrap(),
            serde_json::json!({ "type": "ready", "scale": null })
        );
    }
}
