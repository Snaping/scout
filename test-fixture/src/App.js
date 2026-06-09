"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.App = void 0;
const react_1 = __importDefault(require("react"));
const App = () => {
    return (<div className="used-class another-used">
      <span id="used-id">Hello React</span>
      <div className="nested-used">
        <p className="child-used">World</p>
      </div>
    </div>);
};
exports.App = App;
//# sourceMappingURL=App.js.map