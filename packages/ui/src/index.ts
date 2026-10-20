export { cn } from "./cn";

export {
  Button,
  LinkButton,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
} from "./Button";
export {
  Field,
  Input,
  Select,
  Textarea,
  CheckboxRow,
  Switch,
  type FieldProps,
  type InputProps,
  type SelectProps,
  type TextareaProps,
} from "./Field";
export { PhoneInput, type PhoneInputProps } from "./PhoneInput";
export { MoneyInput, type MoneyInputProps } from "./MoneyInput";
export { PlateInput, type PlateInputProps } from "./PlateInput";
export { StatusBadge, TypeBadge, type StatusTone, type StatusBadgeProps } from "./StatusBadge";
export { Card, type CardProps } from "./Card";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { DataTable, type DataTableColumn, type DataTableProps } from "./DataTable";
export { Modal, type ModalProps } from "./Modal";
export { Stepper, type StepperStep, type StepperProps } from "./Stepper";
export {
  PageHead,
  Breadcrumb,
  Tabs,
  type PageHeadProps,
  type BreadcrumbItem,
  type TabItem,
} from "./PageHeader";
export { SettingsLayout, type SettingsNavItem } from "./SettingsLayout";
export { OtpInput, type OtpInputProps } from "./OtpInput";
export {
  AppShell,
  AppMain,
  Content,
  Sidebar,
  SidebarSection,
  SidebarSectionLabel,
  SidebarSearch,
  NavItem,
  Topbar,
  SearchBox,
  TopbarActions,
  IconButton,
  Avatar,
  DropdownMenu,
  DropdownItem,
  type SidebarProps,
  type SidebarSectionProps,
  type SidebarSearchProps,
  type NavItemProps,
  type TopbarProps,
  type DropdownMenuProps,
} from "./AppShell";
// Ajouts M02/M10 (badges plaque et échéance) ; les autres composants existent déjà ci-dessus.
export { PlateBadge, type PlateBadgeProps } from "./plate-badge";
export { DueBadge, type DueBadgeProps } from "./due-badge";
// M07 — lecture des codes-barres (caméra + douchette USB).
export {
  BarcodeScanner,
  scanFeedback,
  useScannerWedge,
  type BarcodeScannerLabels,
  type BarcodeScannerProps,
} from "./BarcodeScanner";
// M04 — composants tablette de la réception (schéma, jauge, signature, photos).
export {
  BodyDiagram,
  VIEWS,
  VIEW_ZONE_KEYS,
  type BodyDiagramMarker,
  type BodyDiagramProps,
  type BodyType,
  type BodyView,
} from "./BodyDiagram";
export { FuelGauge, type FuelGaugeProps } from "./FuelGauge";
export { SignaturePad, type SignaturePadProps } from "./SignaturePad";
export {
  compressImage,
  PhotoCapture,
  type CompressedImage,
  type PhotoCaptureProps,
  type PhotoStatus,
} from "./PhotoCapture";
